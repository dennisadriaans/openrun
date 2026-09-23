import { nextRunAt } from '@openrun/domain/tasks/schedule'
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
