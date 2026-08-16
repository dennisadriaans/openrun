import parser from 'cron-parser'

export type ScheduleKind = 'hourly' | 'daily' | 'weekly' | 'custom'

export type ParsedSchedule =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; dow: number }
  | { kind: 'custom'; cron: string }

const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function dowLabel(dow: number): string {
  return DOW_LABELS[((dow % 7) + 7) % 7] ?? 'Monday'
}

export function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Cron for the next local hour, used as the Once-at default. */
export function defaultOnceAtCron(from = new Date()): string {
  const next = new Date(from.getTime())
  next.setSeconds(0, 0)
  next.setMilliseconds(0)
  next.setMinutes(0)
  next.setHours(next.getHours() + 1)
  return `${next.getMinutes()} ${next.getHours()} * * *`
}

/** Local timezone label like `GMT+2` / `GMT-5`. */
export function formatTimezoneOffset(date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  if (mins === 0) return `GMT${sign}${hours}`
  return `GMT${sign}${hours}:${String(mins).padStart(2, '0')}`
}

export function parseSchedule(cron: string): ParsedSchedule {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return { kind: 'custom', cron: cron.trim() }

  const [min, hour, dom, month, dow] = parts
  if (!min || !hour || !dom || !month || !dow) return { kind: 'custom', cron: cron.trim() }
  if (month !== '*') return { kind: 'custom', cron: cron.trim() }

  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && dow === '*') {
    return { kind: 'hourly', minute: Number(min) }
  }

  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && dow === '*') {
    return { kind: 'daily', hour: Number(hour), minute: Number(min) }
  }

  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && /^\d+$/.test(dow)) {
    return {
      kind: 'weekly',
      hour: Number(hour),
      minute: Number(min),
      dow: Number(dow) % 7,
    }
  }

  return { kind: 'custom', cron: cron.trim() }
}

export function buildCron(schedule: ParsedSchedule): string {
  switch (schedule.kind) {
    case 'hourly':
      return `${schedule.minute} * * * *`
    case 'daily':
      return `${schedule.minute} ${schedule.hour} * * *`
    case 'weekly':
      return `${schedule.minute} ${schedule.hour} * * ${schedule.dow}`
    case 'custom':
      return schedule.cron
  }
}

/** Leading phrase before interactive controls, e.g. `Every day at`. */
export function scheduleLeadIn(schedule: ParsedSchedule): string {
  switch (schedule.kind) {
    case 'hourly':
      return 'Every hour at'
    case 'daily':
      return 'Every day at'
    case 'weekly':
      return `Every week on ${dowLabel(schedule.dow)} at`
    case 'custom':
      return 'Custom'
  }
}

export function nextRunAt(cron: string, from = new Date()): number | null {
  if (!cron.trim()) return null
  try {
    return parser.parseExpression(cron, { currentDate: from }).next().getTime()
  } catch {
    return null
  }
}

/** e.g. `Next run Sat, Jul 25, 4:00 AM GMT+2` */
export function formatNextRunLabel(cron: string, from = new Date()): string | null {
  const ts = nextRunAt(cron, from)
  if (ts == null) return null
  const date = new Date(ts)
  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
  return `Next run ${formatted} ${formatTimezoneOffset(date)}`
}

export const HOUR_TIMES: Array<{ hour: number; minute: number; label: string }> = Array.from(
  { length: 24 },
  (_, hour) => ({ hour, minute: 0, label: formatTime(hour, 0) }),
)

export const HOURLY_MINUTES = [0, 15, 30, 45]

export const WEEKDAYS = DOW_LABELS.map((label, dow) => ({ dow, label }))
