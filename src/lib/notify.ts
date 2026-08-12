/**
 * Run notifications.
 *
 * Scheduling an agent to run at 6am is only useful if you find out what it did.
 * Until now the only way to learn that a scheduled run went red was to open the
 * app and read a transcript, which defeats the point of unattended automation.
 *
 * This module is the pure half: which runs are worth a notification, what the
 * message says, and what body each destination expects. Delivery (fetch, OS
 * notification) lives in `server/notify.ts`.
 */
import {
  verdictLabel,
  verdictNeedsAttention,
  type RunVerdict,
} from './verdict.ts'

export type NotifierKind = 'webhook' | 'desktop'

export type NotifierRule = {
  enabled: boolean
  /**
   * Verdicts that trigger this notifier. Empty means the needs-attention set
   * (failed checks, timeout, crash) — the default nobody has to think about.
   */
  verdicts: RunVerdict[]
}

export function parseVerdictList(raw: string | null | undefined): RunVerdict[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is RunVerdict => typeof v === 'string' && v.length > 0)
  } catch {
    return []
  }
}

/** Whether a settled run should reach this notifier. */
export function notifierMatches(rule: NotifierRule, verdict: RunVerdict): boolean {
  if (!rule.enabled) return false
  // A cancelled or still-live run has no verdict — never notify on those.
  if (!verdict) return false
  if (rule.verdicts.length === 0) return verdictNeedsAttention(verdict)
  return rule.verdicts.includes(verdict)
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export type RunNotificationInput = {
  runId: string
  taskName: string
  verdict: RunVerdict
  trigger: string
  durationMs: number
  changedFiles: number
  /** Names of the blocking checks that failed, if any. */
  failedChecks: string[]
  /** Repair turns this run spent before settling. */
  repairAttempts: number
}

export type RunNotification = RunNotificationInput & {
  title: string
  body: string
  /** App-relative link to the run. */
  path: string
}

function humanDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function buildRunNotification(input: RunNotificationInput): RunNotification {
  const title = `${verdictLabel(input.verdict)} · ${input.taskName}`

  const parts: string[] = []
  if (input.failedChecks.length > 0) {
    parts.push(`Failing: ${input.failedChecks.join(', ')}`)
  }
  parts.push(
    input.changedFiles === 1 ? '1 file changed' : `${input.changedFiles} files changed`,
  )
  parts.push(`${humanDuration(input.durationMs)} · ${input.trigger}`)
  if (input.repairAttempts > 0) {
    parts.push(
      input.repairAttempts === 1 ? 'after 1 repair turn' : `after ${input.repairAttempts} repair turns`,
    )
  }

  return {
    ...input,
    title,
    body: parts.join(' · '),
    path: `/runs/${encodeURIComponent(input.runId)}`,
  }
}

// ---------------------------------------------------------------------------
// Destination payloads
// ---------------------------------------------------------------------------

export type WebhookShape = 'slack' | 'discord' | 'generic'

/**
 * Guess what the receiving endpoint wants. Slack and Discord both reject the
 * other's body outright, and "post to Slack" is the overwhelmingly common case
 * for a local automation tool — worth detecting rather than making the user
 * pick from a dropdown.
 */
export function detectWebhookShape(url: string): WebhookShape {
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return 'generic'
  }
  if (host.endsWith('slack.com')) return 'slack'
  if (host.endsWith('discord.com') || host.endsWith('discordapp.com')) return 'discord'
  return 'generic'
}

/** The JSON body to POST for a notification, given the destination shape. */
export function webhookPayload(
  notification: RunNotification,
  shape: WebhookShape,
  baseUrl: string,
): Record<string, unknown> {
  const link = `${baseUrl.replace(/\/+$/, '')}${notification.path}`
  const text = `${notification.title}\n${notification.body}\n${link}`

  if (shape === 'slack') return { text }
  if (shape === 'discord') return { content: text }
  return {
    event: 'run.finished',
    runId: notification.runId,
    taskName: notification.taskName,
    verdict: notification.verdict,
    trigger: notification.trigger,
    changedFiles: notification.changedFiles,
    failedChecks: notification.failedChecks,
    repairAttempts: notification.repairAttempts,
    durationMs: notification.durationMs,
    title: notification.title,
    body: notification.body,
    url: link,
  }
}

export function invalidWebhookUrlMessage(): string {
  return 'A webhook notifier needs an http(s) URL to POST to.'
}

// ---------------------------------------------------------------------------
// Delivery list shaping (Notifications UI)
// ---------------------------------------------------------------------------

/** Shown when a delivery row has no usable notifier name from the JOIN. */
export function unknownNotifierLabel(): string {
  return 'Unknown notifier'
}

/**
 * Prefer the JOIN'd notifier name; fall back to the id so a deleted/orphan
 * row still identifies a destination; never return blank for the UI.
 */
export function resolveNotifierName(
  notifierName: string | null | undefined,
  notifierId?: string | null,
): string {
  const name = (notifierName ?? '').trim()
  if (name) return name
  const id = (notifierId ?? '').trim()
  if (id) return id
  return unknownNotifierLabel()
}

/** Reject anything we would fail to POST to at notify time. */
export function assertWebhookUrl(url: string): string {
  const trimmed = url.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(invalidWebhookUrlMessage())
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(invalidWebhookUrlMessage())
  }
  return trimmed
}
