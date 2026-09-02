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
import { verdictLabel, verdictNeedsAttention, type RunVerdict } from './verdict.ts'

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
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is RunVerdict => typeof v === 'string' && v.length > 0)
  } catch {
    return []
  }
}

/**
 * Whether a *refused* scheduled fire should reach this notifier.
 *
 * Deliberately not verdict-filtered. A refusal means the automation did not
 * run at all — there is no verdict to match, and no verdict filter can express
 * "tell me when this stops working". A notifier narrowed to `verified` still
 * wants to hear that its automation has been refused for three days.
 */
export function notifierMatchesRefusal(rule: NotifierRule): boolean {
  return rule.enabled
}

/** Whether a settled run should reach this notifier. */
export function notifierMatches(rule: NotifierRule, verdict: RunVerdict): boolean {
  if (!rule.enabled) return false
  // A cancelled or still-live run has no verdict — never notify on those.
  if (!verdict) return false
  if (rule.verdicts.length === 0) return verdictNeedsAttention(verdict)
  return rule.verdicts.includes(verdict)
}

/**
 * What the delivery log stores in its `verdict` column for a refused fire.
 * A refusal has no run and no verdict; this keeps the one column honest.
 */
export const REFUSED_DELIVERY_VERDICT = 'refused'

/** Fire outcomes that mean the automation did not run and nobody was told. */
export type RefusedFireOutcome = 'failed' | 'missed'

export function isRefusedFireOutcome(outcome: string): outcome is RefusedFireOutcome {
  return outcome === 'failed' || outcome === 'missed'
}

/**
 * Whether this refusal is worth a notification, given the fire before it.
 *
 * A broken automation on a minutely cron would otherwise notify every minute.
 * The same outcome with the same reason twice running is the *same* refusal
 * still in force, and you were told the first time; a new reason, or a
 * recovery followed by a fresh break, notifies again.
 */
export function shouldNotifyRefusal(input: {
  outcome: string
  detail: string
  /** The task's previous fire, if it had one. */
  previous: { outcome: string; detail: string } | null
}): boolean {
  if (!isRefusedFireOutcome(input.outcome)) return false
  const previous = input.previous
  if (!previous) return true
  return !(previous.outcome === input.outcome && previous.detail === input.detail)
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
  parts.push(input.changedFiles === 1 ? '1 file changed' : `${input.changedFiles} files changed`)
  parts.push(`${humanDuration(input.durationMs)} · ${input.trigger}`)
  if (input.repairAttempts > 0) {
    parts.push(
      input.repairAttempts === 1
        ? 'after 1 repair turn'
        : `after ${input.repairAttempts} repair turns`,
    )
  }

  return {
    ...input,
    title,
    body: parts.join(' · '),
    path: `/runs/${encodeURIComponent(input.runId)}`,
  }
}

export type FireRefusalNotificationInput = {
  taskId: string
  taskName: string
  outcome: RefusedFireOutcome
  /** Why the fire was refused, in the words the gate used. */
  detail: string
  scheduledFor: number
}

export type FireRefusalNotification = FireRefusalNotificationInput & {
  title: string
  body: string
  /** App-relative link to the automation. */
  path: string
}

export function buildFireRefusalNotification(
  input: FireRefusalNotificationInput,
): FireRefusalNotification {
  const name = input.taskName.trim() || 'an automation'
  const title = input.outcome === 'missed' ? `Missed · ${name}` : `Did not run · ${name}`
  const detail = input.detail.trim() || 'No reason was recorded.'
  return {
    ...input,
    title,
    body: detail,
    path: `/tasks/${encodeURIComponent(input.taskId)}`,
  }
}

// ---------------------------------------------------------------------------
// Destination payloads
// ---------------------------------------------------------------------------

export type WebhookShape = 'discord' | 'generic'

/**
 * Guess what the receiving endpoint wants. Discord rejects a generic body
 * outright, so it is worth detecting rather than making the user pick from a
 * dropdown.
 */
export function detectWebhookShape(url: string): WebhookShape {
  let host = ''
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return 'generic'
  }
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

/** The JSON body to POST when a scheduled fire was refused. */
export function fireRefusalWebhookPayload(
  notification: FireRefusalNotification,
  shape: WebhookShape,
  baseUrl: string,
): Record<string, unknown> {
  const link = `${baseUrl.replace(/\/+$/, '')}${notification.path}`
  const text = `${notification.title}\n${notification.body}\n${link}`

  if (shape === 'discord') return { content: text }
  return {
    event: 'fire.refused',
    taskId: notification.taskId,
    taskName: notification.taskName,
    outcome: notification.outcome,
    detail: notification.detail,
    scheduledFor: notification.scheduledFor,
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
