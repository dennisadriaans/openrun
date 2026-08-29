/** Small presentation helpers shared across the UI. */
import { isValidCron } from './cron.ts'

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const hours = Math.round(abs / 3600000)
  const days = Math.round(abs / 86400000)
  let out: string
  if (abs < 60000) out = 'just now'
  else if (mins < 60) out = `${mins}m`
  else if (hours < 24) out = `${hours}h`
  else out = `${days}d`
  if (out === 'just now') return out
  return diff < 0 ? `${out} ago` : `in ${out}`
}

export function absoluteTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ordinalSuffix(day: number): string {
  const lastTwo = day % 100
  if (lastTwo >= 11 && lastTwo <= 13) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/** Short wall-clock time for message hover meta, e.g. `3:04 PM`. */
export function formatShortTimestamp(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts))
}

/** Full tooltip label, e.g. `3:04 PM, 22nd July 2026`. */
export function formatChatTimestampTooltip(ts: number | null | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  const time = formatShortTimestamp(ts)
  const day = date.getDate()
  const month = new Intl.DateTimeFormat(undefined, { month: 'long' }).format(date)
  return `${time}, ${day}${ordinalSuffix(day)} ${month} ${date.getFullYear()}`
}

/**
 * Whole-second elapsed label for a turn that is still running — the transcript
 * repaints it every second, so tenths would only flicker.
 */
export function elapsedLabel(start: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function duration(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}

/**
 * Status presentation.
 *
 * One anatomy for every status: a coloured dot plus a muted label. Hue lives
 * on the dot only (`success`, `danger`, `warn`, or the quaternary tick), so a
 * Failed row is not a red word and Success is not a green word. `running`
 * still pulses via `live-dot` so an in-flight run is distinct from a finished
 * one. Archived is one step quieter (`text-tier-quaternary`) because it is
 * not an active row in these lists.
 */
const STATUS_META: Record<string, { label: string; text: string; dot: string }> = {
  running: {
    label: 'Running',
    text: 'text-tier-tertiary',
    dot: 'bg-success',
  },
  queued: {
    label: 'Queued',
    text: 'text-tier-tertiary',
    dot: 'bg-[var(--text-quaternary)]',
  },
  success: {
    label: 'Success',
    text: 'text-tier-tertiary',
    dot: 'bg-success',
  },
  error: {
    label: 'Failed',
    text: 'text-tier-tertiary',
    dot: 'bg-danger',
  },
  cancelled: {
    label: 'Cancelled',
    text: 'text-tier-tertiary',
    dot: 'bg-[var(--text-quaternary)]',
  },
  // Workspace statuses (see WorkspaceRow['status']) share this table via StatusBadge.
  creating: {
    label: 'Creating',
    text: 'text-tier-tertiary',
    dot: 'bg-[var(--text-quaternary)]',
  },
  ready: {
    label: 'Ready',
    text: 'text-tier-tertiary',
    dot: 'bg-success',
  },
  archived: {
    label: 'Archived',
    text: 'text-tier-quaternary',
    dot: 'bg-[var(--text-quaternary)]',
  },
  enabled: {
    label: 'Enabled',
    text: 'text-tier-tertiary',
    dot: 'bg-success',
  },
  paused: {
    label: 'Paused',
    text: 'text-tier-tertiary',
    dot: 'bg-warn',
  },
}

export function statusMeta(status: string) {
  return STATUS_META[status] ?? STATUS_META.cancelled
}

/** Schedule badge for an automation — live run state overrides enabled/paused. */
export function taskScheduleStatus(enabled: boolean, isRunning: boolean): string {
  if (isRunning) return 'running'
  return enabled ? 'enabled' : 'paused'
}

/** Human-readable-ish description of a subset of common cron patterns. */
export function describeCron(cron: string): string {
  if (!cron.trim()) return 'Manual only'
  // Prefer an explicit invalid label over echoing junk (or mis-describing
  // out-of-range fields like `60 9 * * *` as "Daily at 09:60").
  if (!isValidCron(cron)) return 'Invalid schedule'
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, dom, , dow] = parts
  if (cron === '* * * * *') return 'Every minute'
  if (min.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} minutes`
  if (hour.startsWith('*/') && min === '0') return `Every ${hour.slice(2)} hours`
  if (dom === '*' && dow === '*' && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (/^\d+$/.test(dow) && /^\d+$/.test(min) && /^\d+$/.test(hour))
    return `${days[Number(dow) % 7]} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  return cron
}

export const CRON_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily 9am', value: '0 9 * * *' },
  { label: 'Daily 6pm', value: '0 18 * * *' },
  { label: 'Weekdays 8am', value: '0 8 * * 1-5' },
  { label: 'Monday 9am', value: '0 9 * * 1' },
]

/** A one-shot stores a cron only to carry its time of day; never call it "Daily". */
export function describeSchedule(task: {
  cron: string
  fireOnce?: number | boolean
  scheduledAt?: number
}): string {
  const base = describeCron(task.cron)
  if (!task.fireOnce) return base
  if (task.scheduledAt && task.scheduledAt > 0)
    return `Once ${new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(task.scheduledAt))}`
  const time = /(\d{2}:\d{2})$/.exec(base)?.[1]
  return time ? `Once at ${time}` : base
}
