/**
 * Recurring fires that were due while Open Run was not running.
 *
 * `node-cron` only observes ticks a live process is there to see. A one-shot
 * already survives downtime — it stores an absolute time and catches up inside
 * a grace window (`oneShotSchedule.ts`) — but a recurring automation had
 * nothing equivalent: close the laptop at 17:00, open it at 09:00, and the
 * 03:00 daily simply never happened and left no record at all. The Automations
 * page still read "next run in 18 hours", which is true and useless.
 *
 * This module answers, for one automation, what was due while we were away and
 * what to do about it. The policy deliberately mirrors the one-shot rule:
 * catch up when the most recent missed occurrence is still fresh, otherwise
 * record a visible miss rather than silently moving on to tomorrow. Firing a
 * whole night's backlog the moment a laptop opens would be worse than missing
 * it — so at most one catch-up run happens, for the newest occurrence.
 *
 * Pure and browser-safe (`cron-parser` runs in both), so the scheduler and any
 * UI that wants to explain a miss share one rule.
 */
import parser from 'cron-parser'

/**
 * How late a recurring occurrence may be and still be run on wake. Matches
 * `ONE_SHOT_GRACE_MS` on purpose: the two schedule kinds should not disagree
 * about what "just missed it" means.
 */
export const MISSED_FIRE_CATCHUP_GRACE_MS = 15 * 60_000

/**
 * Ceiling on how many occurrences we bother to count. A minutely automation
 * and a fortnight of downtime is 20,000 iterations to report a number nobody
 * reads precisely; past this we say "at least N".
 */
export const MAX_COUNTED_MISSES = 500

export type MissedFireDecision =
  /** Nothing was due while we were away. */
  | { kind: 'none' }
  /** The newest missed occurrence is fresh enough to still run now. */
  | { kind: 'catch-up'; scheduledFor: number; missedCount: number; capped: boolean }
  /** Too late to run; record it so the miss is visible instead of silent. */
  | {
      kind: 'missed'
      scheduledFor: number
      missedCount: number
      capped: boolean
      lateByMs: number
    }

/**
 * Occurrences of `cron` strictly after `since` and at or before `now`.
 *
 * Ascending, and capped at {@link MAX_COUNTED_MISSES}. An invalid or empty
 * expression yields nothing rather than throwing — an automation with a broken
 * cron is already reported as "won't fire" by `scheduleHealth`.
 */
export function occurrencesBetween(cron: string, since: number, now: number): number[] {
  if (!cron.trim()) return []
  if (!Number.isFinite(since) || !Number.isFinite(now)) return []
  if (since >= now) return []

  const out: number[] = []
  try {
    const iterator = parser.parseExpression(cron, { currentDate: new Date(since) })
    while (out.length < MAX_COUNTED_MISSES) {
      const next = iterator.next().getTime()
      if (next > now) break
      out.push(next)
    }
  } catch {
    return []
  }
  return out
}

/** The newest occurrence in the window, independent of the counting cap. */
function latestOccurrenceBetween(cron: string, since: number, now: number): number | null {
  if (!cron.trim() || !Number.isFinite(since) || !Number.isFinite(now) || since >= now) return null
  try {
    // `prev()` is strict, so advance one millisecond to include a fire exactly at `now`.
    const iterator = parser.parseExpression(cron, { currentDate: new Date(now + 1) })
    const latest = iterator.prev().getTime()
    return latest > since && latest <= now ? latest : null
  } catch {
    return null
  }
}

/**
 * What to do about a recurring automation on boot.
 *
 * `since` is the last moment we know the scheduler was watching this
 * automation — its most recent recorded fire, or when it was last saved.
 * Occurrences before that point are not ours to claim.
 */
export function missedFireDecision(input: {
  cron: string
  since: number
  now: number
  graceMs?: number
}): MissedFireDecision {
  const occurrences = occurrencesBetween(input.cron, input.since, input.now)
  if (occurrences.length === 0) return { kind: 'none' }

  const scheduledFor = latestOccurrenceBetween(input.cron, input.since, input.now)
  if (scheduledFor === null) return { kind: 'none' }
  const missedCount = occurrences.length
  const capped = missedCount >= MAX_COUNTED_MISSES
  const graceMs = input.graceMs ?? MISSED_FIRE_CATCHUP_GRACE_MS
  const lateByMs = input.now - scheduledFor

  if (lateByMs <= graceMs) return { kind: 'catch-up', scheduledFor, missedCount, capped }
  return { kind: 'missed', scheduledFor, missedCount, capped, lateByMs }
}

function countLabel(missedCount: number, capped: boolean): string {
  if (capped) return `at least ${missedCount} runs`
  return missedCount === 1 ? '1 run' : `${missedCount} runs`
}

function agoLabel(lateByMs: number): string {
  const minutes = Math.round(lateByMs / 60_000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Audit detail for a miss that was too old to catch up. */
export function missedFireDetail(input: {
  missedCount: number
  capped: boolean
  lateByMs: number
}): string {
  return (
    `Open Run was not running when this was due — ${countLabel(input.missedCount, input.capped)} ` +
    `were missed, the most recent ${agoLabel(input.lateByMs)} ago. ` +
    `Only a fire within ${Math.round(MISSED_FIRE_CATCHUP_GRACE_MS / 60_000)} minutes is caught up on wake; ` +
    `run it now if you still want it.`
  )
}

/** Audit detail for a miss that was fresh enough to run on wake. */
export function caughtUpFireDetail(input: { missedCount: number; capped: boolean }): string {
  return (
    `Open Run was not running when this was due — ${countLabel(input.missedCount, input.capped)} ` +
    `were missed. The most recent one was still inside the catch-up window and is running now.`
  )
}
