/**
 * Cron helpers shared by the TaskForm (browser) and the scheduler / task
 * write-path (server). Kept dependency-free so the client never bundles
 * node-cron; semantics match what `node-cron.validate` accepts for 5- and
 * 6-field expressions.
 */

const MONTH_NAMES = new Set([
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
])

const DOW_NAMES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])

/** Trim; empty means manual-only (not scheduled). */
export function normalizeCron(expr: string): string {
  return expr.trim()
}

function isNamedToken(token: string, names: Set<string> | undefined): boolean {
  if (!names) return false
  return names.has(token.toLowerCase())
}

function isNumericInRange(token: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(token)) return false
  const n = Number(token)
  return n >= min && n <= max
}

/**
 * Validate one cron field (after list-splitting on `,`).
 * Accepts star, star/step, n, n-m, n-m/step, and optional month/dow names.
 */
function isValidCronField(field: string, min: number, max: number, names?: Set<string>): boolean {
  if (!field) return false
  return field.split(',').every((part) => {
    if (!part) return false

    const [rangePart, stepPart] = part.split('/')
    if (part.includes('/') && (stepPart === undefined || stepPart === '')) return false
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return false
      const step = Number(stepPart)
      if (step <= 0) return false
    }

    if (rangePart === undefined || rangePart === '') return false
    if (rangePart === '*') return true
    // node-cron accepts steps on * and ranges, but not on a single value/name.
    if (stepPart !== undefined && !rangePart.includes('-')) return false

    if (rangePart.includes('-')) {
      const [start, end, ...rest] = rangePart.split('-')
      if (rest.length > 0 || start === undefined || end === undefined) return false
      const startOk = isNumericInRange(start, min, max) || isNamedToken(start, names)
      const endOk = isNumericInRange(end, min, max) || isNamedToken(end, names)
      if (!startOk || !endOk) return false
      if (/^\d+$/.test(start) && /^\d+$/.test(end) && Number(end) < Number(start)) {
        return false
      }
      return true
    }

    return isNumericInRange(rangePart, min, max) || isNamedToken(rangePart, names)
  })
}

/**
 * Whether a cron expression can be armed by the scheduler.
 * Empty is valid (manual-only). Non-empty must be a standard 5- or 6-field
 * expression (minute hour dom month dow[, with optional leading seconds]).
 */
export function isValidCron(expr: string): boolean {
  const cron = normalizeCron(expr)
  if (!cron) return true

  const fields = cron.split(/\s+/)
  if (fields.length !== 5 && fields.length !== 6) return false

  const normalized = fields.length === 6 ? fields : ['0', ...fields]
  const [second, minute, hour, dom, month, dow] = normalized
  return (
    isValidCronField(second!, 0, 59) &&
    isValidCronField(minute!, 0, 59) &&
    isValidCronField(hour!, 0, 23) &&
    isValidCronField(dom!, 1, 31) &&
    isValidCronField(month!, 1, 12, MONTH_NAMES) &&
    isValidCronField(dow!, 0, 7, DOW_NAMES)
  )
}

/** Developer-facing error for a rejected cron expression. */
export function invalidCronMessage(expr: string): string {
  const cron = normalizeCron(expr)
  return `Invalid cron expression "${cron}". Use a standard 5-field schedule (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1-5", or leave it empty for manual-only.`
}

/** Throw when `expr` is non-empty and not schedulable. */
export function assertValidCron(expr: string): void {
  if (!isValidCron(expr)) throw new Error(invalidCronMessage(expr))
}
