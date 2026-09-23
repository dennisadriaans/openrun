import { dowLabel, nextRunAt, parseSchedule } from '@openrun/domain/tasks/schedule'
import type { CliSchedule } from '../commands/cliSchedule.ts'

/** Local time, with a date only when the task is not due today. */
export function scheduleTime(at: number, now = new Date()): string {
  const date = new Date(at)
  const today = date.toDateString() === now.toDateString()
  return new Intl.DateTimeFormat(undefined, {
    ...(!today ? { month: 'short' as const, day: 'numeric' as const } : {}),
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    ...(date.getSeconds() ? { second: '2-digit' as const } : {}),
    hour12: false,
  }).format(date)
}

export function scheduleTiming(schedule: CliSchedule): string {
  if (schedule.kind === 'now') return 'Now'
  if (schedule.kind === 'once') return scheduleTime(schedule.at)
  const next = nextRunAt(schedule.cron)
  return `${next ? scheduleTime(next) : 'Time unavailable'} · repeats (${schedule.cron})`
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "in 10 seconds", "in 3 hours", "tomorrow"; "now" once the time has passed. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000)
  if (seconds <= 0) return 'now'
  if (seconds < 60) return relative.format(seconds, 'second')
  if (seconds < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (seconds < 86_400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86_400), 'day')
}

/** "every day", "every Monday"; the raw expression when it has no plain name. */
export function repeatLabel(cron: string): string {
  const schedule = parseSchedule(cron)
  if (schedule.kind === 'hourly') return 'every hour'
  if (schedule.kind === 'daily') return 'every day'
  if (schedule.kind === 'weekly') return `every ${dowLabel(schedule.dow)}`
  return `repeats (${schedule.cron})`
}
