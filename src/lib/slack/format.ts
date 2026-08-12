/**
 * Slack mrkdwn helpers (browser-safe, dependency-free).
 *
 * Slack's mrkdwn is not markdown: links are `<url|label>`, and `&`, `<`, `>`
 * must be entity-escaped or Slack silently eats whatever follows. Everything
 * that interpolates run output into a message goes through here.
 */

/** Slack rejects a section block whose text exceeds 3000 characters. */
export const SECTION_TEXT_LIMIT = 3000

export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function slackLink(url: string, label: string): string {
  // A label containing `|` or `>` would terminate the link early.
  return `<${url}|${label.replace(/[|>]/g, ' ')}>`
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max <= 1) return text.slice(0, max)
  return `${text.slice(0, max - 1)}…`
}

/**
 * Fit text into a code block that still leaves room for the fences.
 * Keeps the *tail* — the end of a log is where the failure is.
 */
export function codeBlock(text: string, max = SECTION_TEXT_LIMIT): string {
  const fence = '```'
  const room = max - fence.length * 2 - 2
  const body = text.length > room ? `…${text.slice(-(room - 1))}` : text
  return `${fence}\n${body || '(empty)'}\n${fence}`
}

const STATUS_EMOJI: Record<string, string> = {
  running: ':hourglass_flowing_sand:',
  queued: ':clock3:',
  success: ':white_check_mark:',
  failed: ':x:',
  error: ':x:',
  cancelled: ':heavy_multiplication_x:',
}

const VERDICT_EMOJI: Record<string, string> = {
  'failed-checks': ':warning:',
  timeout: ':alarm_clock:',
  crashed: ':boom:',
  passed: ':white_check_mark:',
}

/**
 * One glyph for a run. A verdict is more specific than the status that carries
 * it — a run can exit 0 and still have failed its checks — so it wins.
 */
export function statusEmoji(status: string, verdict?: string): string {
  if (verdict && VERDICT_EMOJI[verdict]) return VERDICT_EMOJI[verdict]
  return STATUS_EMOJI[status] ?? ':grey_question:'
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact age for a phone screen: `just now`, `4m ago`, `3h ago`, `2d ago`. */
export function relativeTime(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return 'unknown'
  const delta = now - timestamp
  if (delta < 0) return 'scheduled'
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  return `${Math.floor(delta / DAY)}d ago`
}

/** How long a run took, or how long it has been going. */
export function durationLabel(
  startedAt: number | null | undefined,
  finishedAt: number | null | undefined,
  now = Date.now(),
): string {
  if (!startedAt) return ''
  const end = finishedAt ?? now
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/**
 * Short handle for a run so a phone can type it back: `run_ma1b2c3d` → `#3`
 * when it is the third most recent, otherwise the raw id.
 */
export function runHandle(runId: string, ordinal?: number): string {
  return ordinal && ordinal > 0 ? `#${ordinal}` : runId
}
