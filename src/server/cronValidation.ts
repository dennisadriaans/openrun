import cron from 'node-cron'
import { invalidCronMessage, isValidCron, normalizeCron } from '../lib/cron.ts'

/** The exact validation contract used by the scheduler process. */
export function isSchedulableCron(expr: string): boolean {
  const normalized = normalizeCron(expr)
  return isValidCron(normalized) && (!normalized || cron.validate(normalized))
}

export function assertSchedulableCron(expr: string): void {
  if (!isSchedulableCron(expr)) throw new Error(invalidCronMessage(expr))
}
