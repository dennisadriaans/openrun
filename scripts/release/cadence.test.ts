import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CadenceConfigError,
  DEFAULT_CADENCE,
  isReleaseDue,
  parseCadence,
  zonedNow,
} from './cadence.ts'

test('an absent config is the weekly default', () => {
  assert.deepEqual(parseCadence(undefined), DEFAULT_CADENCE)
  assert.deepEqual(parseCadence(null), DEFAULT_CADENCE)
})

test('a partial config fills the rest from the default', () => {
  assert.deepEqual(parseCadence({ cadence: 'daily' }), { ...DEFAULT_CADENCE, cadence: 'daily' })
  assert.deepEqual(parseCadence({ day: 'friday' }), { ...DEFAULT_CADENCE, day: 'friday' })
})

test('reads a full config', () => {
  assert.deepEqual(
    parseCadence({
      cadence: 'weekly',
      day: 'thursday',
      time: '17:30',
      timezone: 'America/New_York',
    }),
    { cadence: 'weekly', day: 'thursday', time: '17:30', timezone: 'America/New_York' },
  )
})

test('a bad field throws instead of silently reverting to the default', () => {
  // A typo'd zone that quietly fell back would move release day without saying so.
  assert.throws(() => parseCadence({ cadence: 'hourly' }), CadenceConfigError)
  assert.throws(() => parseCadence({ day: 'moonday' }), CadenceConfigError)
  assert.throws(() => parseCadence({ time: '9:00' }), CadenceConfigError)
  assert.throws(() => parseCadence({ time: '24:00' }), CadenceConfigError)
  assert.throws(() => parseCadence({ timezone: 'Europe/Atlantis' }), CadenceConfigError)
  assert.throws(() => parseCadence(['weekly']), CadenceConfigError)
})

test('reads wall-clock parts in the configured zone', () => {
  // 2026-08-31T07:30Z is Monday 09:30 in Amsterdam (CEST, UTC+2).
  const parts = zonedNow(new Date('2026-08-31T07:30:00Z'), 'Europe/Amsterdam')
  assert.deepEqual(parts, { weekday: 'monday', hour: 9, minute: 30, date: '2026-08-31' })
})

test('the zone, not UTC, decides which day it is', () => {
  // Sunday 23:30 UTC is already Monday in Amsterdam.
  const parts = zonedNow(new Date('2026-08-30T23:30:00Z'), 'Europe/Amsterdam')
  assert.equal(parts.weekday, 'monday')
  assert.equal(parts.date, '2026-08-31')
})

const weekly = parseCadence({ cadence: 'weekly', day: 'monday', time: '09:00' })

test('weekly is due on its day once the window opens', () => {
  const verdict = isReleaseDue(weekly, new Date('2026-08-31T07:00:00Z'))
  assert.equal(verdict.due, true)
  assert.equal(verdict.date, '2026-08-31')
})

test('weekly stays due later in the day, so a late cron does not skip a week', () => {
  assert.equal(isReleaseDue(weekly, new Date('2026-08-31T15:00:00Z')).due, true)
})

test('weekly is not due before the window opens', () => {
  const verdict = isReleaseDue(weekly, new Date('2026-08-31T05:00:00Z'))
  assert.equal(verdict.due, false)
  assert.match(verdict.reason, /Too early/)
})

test('weekly is not due on another weekday', () => {
  const verdict = isReleaseDue(weekly, new Date('2026-09-02T07:00:00Z'))
  assert.equal(verdict.due, false)
  assert.match(verdict.reason, /Not release day/)
})

test('daily ignores the weekday but still respects the time', () => {
  const daily = parseCadence({ cadence: 'daily', time: '09:00' })
  assert.equal(isReleaseDue(daily, new Date('2026-09-02T07:00:00Z')).due, true)
  assert.equal(isReleaseDue(daily, new Date('2026-09-02T05:00:00Z')).due, false)
})

test('manual is never due on a schedule', () => {
  const manual = parseCadence({ cadence: 'manual' })
  const verdict = isReleaseDue(manual, new Date('2026-08-31T07:00:00Z'))
  assert.equal(verdict.due, false)
  assert.match(verdict.reason, /manual/)
})

test('the window follows daylight saving without a workflow edit', () => {
  // Both instants are 09:00 Amsterdam; the UTC offset differs (CEST vs CET).
  const summer = isReleaseDue(weekly, new Date('2026-08-31T07:00:00Z'))
  const winter = isReleaseDue(weekly, new Date('2026-11-30T08:00:00Z'))
  assert.equal(summer.due, true)
  assert.equal(winter.due, true)
  assert.equal(isReleaseDue(weekly, new Date('2026-11-30T07:00:00Z')).due, false)
})
