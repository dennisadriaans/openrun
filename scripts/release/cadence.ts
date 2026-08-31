/**
 * When to *ask* whether a release exists.
 *
 * Cadence is deliberately independent of release semantics: this module decides
 * whether now is a release moment, and `plan.ts` decides — separately, and only
 * if asked — whether there is anything to release. Monday arriving is never a
 * reason to publish a version.
 *
 * The schedule lives in config rather than in the workflow's cron so that
 * changing "weekly on Monday" to "daily" is a one-line edit that both the CI job
 * and a local `pnpm release:plan` observe, and so the hour can be expressed in a
 * real timezone instead of hand-converted to UTC every daylight-saving switch.
 */

export type CadenceKind = 'daily' | 'weekly' | 'manual'

export type CadenceConfig = {
  cadence: CadenceKind
  /** Weekday for `weekly`, lowercase. Ignored otherwise. */
  day: Weekday
  /** `HH:MM`, 24-hour, in `timezone`. */
  time: string
  /** IANA zone name. */
  timezone: string
}

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

const WEEKDAYS: readonly Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

/**
 * Weekly beats daily as a default: a week's worth of merges is enough substance
 * to be worth announcing, and an urgent patch can still be cut by hand at any
 * time through `workflow_dispatch`.
 */
export const DEFAULT_CADENCE: CadenceConfig = {
  cadence: 'weekly',
  day: 'monday',
  time: '09:00',
  timezone: 'Europe/Amsterdam',
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export class CadenceConfigError extends Error {}

/**
 * Validates a raw `release` block from package.json.
 *
 * Throws rather than falling back on a bad field: a typo'd timezone that
 * silently reverted to the default would move release day without saying so.
 */
export function parseCadence(raw: unknown): CadenceConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_CADENCE }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CadenceConfigError('release config must be an object.')
  }

  const input = raw as Record<string, unknown>
  const config: CadenceConfig = { ...DEFAULT_CADENCE }

  if (input.cadence !== undefined) {
    const cadence = String(input.cadence).toLowerCase()
    if (cadence !== 'daily' && cadence !== 'weekly' && cadence !== 'manual') {
      throw new CadenceConfigError(
        `release.cadence must be "daily", "weekly" or "manual"; got "${input.cadence}".`,
      )
    }
    config.cadence = cadence
  }

  if (input.day !== undefined) {
    const day = String(input.day).toLowerCase() as Weekday
    if (!WEEKDAYS.includes(day)) {
      throw new CadenceConfigError(`release.day must be a weekday name; got "${input.day}".`)
    }
    config.day = day
  }

  if (input.time !== undefined) {
    const time = String(input.time)
    if (!TIME.test(time)) {
      throw new CadenceConfigError(`release.time must be HH:MM (24-hour); got "${time}".`)
    }
    config.time = time
  }

  if (input.timezone !== undefined) {
    const timezone = String(input.timezone)
    if (!isValidTimeZone(timezone)) {
      throw new CadenceConfigError(`release.timezone is not an IANA zone: "${timezone}".`)
    }
    config.timezone = timezone
  }

  return config
}

function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export type ZonedNow = {
  weekday: Weekday
  hour: number
  minute: number
  /** `YYYY-MM-DD` in the configured zone — the release day's identity. */
  date: string
}

/** Splits an instant into the wall-clock parts of a timezone, with no deps. */
export function zonedNow(now: Date, timezone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    weekday: find('weekday').toLowerCase() as Weekday,
    hour: Number(find('hour')),
    minute: Number(find('minute')),
    date: `${find('year')}-${find('month')}-${find('day')}`,
  }
}

export type CadenceVerdict = {
  due: boolean
  /** One sentence for the job summary, whichever way it went. */
  reason: string
  /** The release day's date in the configured zone, for idempotency keys. */
  date: string
}

/**
 * Is now a release moment?
 *
 * The check is "past the configured time on a matching day" rather than "at the
 * configured minute", because a workflow cron fires late under load and a
 * missed-by-four-minutes window would skip a whole week. Running twice in one
 * day is harmless — `prepare` is idempotent on the version it computes.
 */
export function isReleaseDue(config: CadenceConfig, now: Date = new Date()): CadenceVerdict {
  const zoned = zonedNow(now, config.timezone)
  const clock = `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`
  const where = `${clock} ${config.timezone}, ${zoned.weekday}`

  if (config.cadence === 'manual') {
    return {
      due: false,
      date: zoned.date,
      reason: 'Cadence is "manual" — releases only start from a manual dispatch.',
    }
  }

  if (config.cadence === 'weekly' && zoned.weekday !== config.day) {
    return {
      due: false,
      date: zoned.date,
      reason: `Not release day: cadence is weekly on ${config.day}, and it is ${where}.`,
    }
  }

  if (clock < config.time) {
    return {
      due: false,
      date: zoned.date,
      reason: `Too early: the window opens at ${config.time} ${config.timezone}, and it is ${clock}.`,
    }
  }

  return {
    due: true,
    date: zoned.date,
    reason: `Release window is open (${config.cadence}, from ${config.time} ${config.timezone}; now ${where}).`,
  }
}
