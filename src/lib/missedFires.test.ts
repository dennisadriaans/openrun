import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  caughtUpFireDetail,
  MAX_COUNTED_MISSES,
  MISSED_FIRE_CATCHUP_GRACE_MS,
  missedFireDecision,
  missedFireDetail,
  occurrencesBetween,
} from './missedFires.ts'

const HOUR = 60 * 60_000
/** 2024-01-10T00:00:00Z — a fixed point so the cron maths is deterministic. */
const T0 = Date.UTC(2024, 0, 10, 0, 0, 0)

describe('occurrencesBetween', () => {
  it('lists every hourly occurrence in the window', () => {
    const found = occurrencesBetween('0 * * * *', T0, T0 + 3 * HOUR)
    assert.deepEqual(found, [T0 + HOUR, T0 + 2 * HOUR, T0 + 3 * HOUR])
  })

  it('excludes the boundary it starts from and includes the one it ends on', () => {
    const found = occurrencesBetween('0 * * * *', T0, T0 + HOUR)
    assert.deepEqual(found, [T0 + HOUR])
  })

  it('is empty when no time passed', () => {
    assert.deepEqual(occurrencesBetween('0 * * * *', T0, T0), [])
    assert.deepEqual(occurrencesBetween('0 * * * *', T0 + HOUR, T0), [])
  })

  it('is empty rather than throwing for a broken expression', () => {
    assert.deepEqual(occurrencesBetween('not a cron', T0, T0 + HOUR), [])
    assert.deepEqual(occurrencesBetween('   ', T0, T0 + HOUR), [])
  })

  it('stops counting at the cap instead of iterating forever', () => {
    // A minutely cron over a year would be half a million iterations.
    const found = occurrencesBetween('* * * * *', T0, T0 + 365 * 24 * HOUR)
    assert.equal(found.length, MAX_COUNTED_MISSES)
  })
})

describe('missedFireDecision', () => {
  it('reports nothing when the automation was never due', () => {
    assert.deepEqual(missedFireDecision({ cron: '0 3 * * *', since: T0, now: T0 + HOUR }), {
      kind: 'none',
    })
  })

  it('catches up a fire that was only just missed', () => {
    // Due at 01:00, woke at 01:05.
    const decision = missedFireDecision({
      cron: '0 * * * *',
      since: T0,
      now: T0 + HOUR + 5 * 60_000,
    })
    assert.equal(decision.kind, 'catch-up')
    assert.equal(decision.kind === 'catch-up' && decision.scheduledFor, T0 + HOUR)
    assert.equal(decision.kind === 'catch-up' && decision.missedCount, 1)
  })

  it('refuses to catch up a fire that is past the grace window', () => {
    const now = T0 + HOUR + MISSED_FIRE_CATCHUP_GRACE_MS + 60_000
    const decision = missedFireDecision({ cron: '0 3 * * *', since: T0 - 24 * HOUR, now })
    assert.equal(decision.kind, 'missed')
  })

  it('only ever offers the newest occurrence, never a whole backlog', () => {
    // A night of downtime on an hourly cron: eight were due. Waking one minute
    // after the newest means it is caught up — but only that one, never eight.
    const decision = missedFireDecision({
      cron: '0 * * * *',
      since: T0,
      now: T0 + 8 * HOUR + 60_000,
    })
    assert.equal(decision.kind, 'catch-up')
    if (decision.kind !== 'catch-up') return
    assert.equal(decision.missedCount, 8)
    assert.equal(decision.scheduledFor, T0 + 8 * HOUR)
  })

  it('records a stale backlog as missed rather than running any of it', () => {
    // Woke mid-hour, so the newest occurrence is well past the grace window.
    const decision = missedFireDecision({
      cron: '0 * * * *',
      since: T0,
      now: T0 + 8 * HOUR + 40 * 60_000,
    })
    assert.equal(decision.kind, 'missed')
    if (decision.kind !== 'missed') return
    assert.equal(decision.missedCount, 8)
    assert.equal(decision.scheduledFor, T0 + 8 * HOUR)
  })

  it('honours an explicit grace window', () => {
    const decision = missedFireDecision({
      cron: '0 * * * *',
      since: T0,
      now: T0 + HOUR + 60_000,
      graceMs: 0,
    })
    assert.equal(decision.kind, 'missed')
  })

  it('marks a capped count so the wording can say "at least"', () => {
    const decision = missedFireDecision({
      cron: '* * * * *',
      since: T0,
      now: T0 + 365 * 24 * HOUR,
    })
    assert.equal(decision.kind === 'missed' && decision.capped, true)
  })
})

describe('detail wording', () => {
  it('says how many were missed and how late the newest one is', () => {
    const detail = missedFireDetail({ missedCount: 8, capped: false, lateByMs: 3 * HOUR })
    assert.match(detail, /8 runs/)
    assert.match(detail, /3 hours ago/)
    assert.match(detail, /run it now/)
  })

  it('says "at least" once the count is capped', () => {
    const detail = missedFireDetail({ missedCount: 500, capped: true, lateByMs: HOUR })
    assert.match(detail, /at least 500 runs/)
  })

  it('uses the singular for one missed run', () => {
    const detail = missedFireDetail({ missedCount: 1, capped: false, lateByMs: 20 * 60_000 })
    assert.match(detail, /1 run were|1 run /)
    assert.match(detail, /20 minutes ago/)
  })

  it('explains a catch-up differently from a miss', () => {
    const detail = caughtUpFireDetail({ missedCount: 1, capped: false })
    assert.match(detail, /running now/)
  })
})
