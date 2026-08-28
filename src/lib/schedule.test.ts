import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildCron,
  defaultOnceAtCron,
  formatTime,
  formatScheduledRunLabel,
  formatTimezoneOffset,
  nextRunAt,
  parseSchedule,
  scheduleLeadIn,
} from './schedule.ts'

describe('parseSchedule', () => {
  it('detects hourly', () => {
    assert.deepEqual(parseSchedule('0 * * * *'), { kind: 'hourly', minute: 0 })
    assert.deepEqual(parseSchedule('30 * * * *'), { kind: 'hourly', minute: 30 })
  })

  it('detects daily', () => {
    assert.deepEqual(parseSchedule('0 9 * * *'), { kind: 'daily', hour: 9, minute: 0 })
    assert.deepEqual(parseSchedule('0 4 * * *'), { kind: 'daily', hour: 4, minute: 0 })
  })

  it('detects weekly', () => {
    assert.deepEqual(parseSchedule('0 9 * * 1'), {
      kind: 'weekly',
      hour: 9,
      minute: 0,
      dow: 1,
    })
  })

  it('falls back to custom', () => {
    assert.deepEqual(parseSchedule('0 9 * * 1-5'), { kind: 'custom', cron: '0 9 * * 1-5' })
    assert.deepEqual(parseSchedule('*/5 * * * *'), { kind: 'custom', cron: '*/5 * * * *' })
  })
})

describe('buildCron', () => {
  it('round-trips presets', () => {
    for (const cron of ['0 * * * *', '0 9 * * *', '0 9 * * 1', '15 4 * * 5']) {
      assert.equal(buildCron(parseSchedule(cron)), cron)
    }
  })
})

describe('scheduleLeadIn', () => {
  it('labels each kind', () => {
    assert.equal(scheduleLeadIn({ kind: 'hourly', minute: 0 }), 'Every hour at')
    assert.equal(scheduleLeadIn({ kind: 'daily', hour: 4, minute: 0 }), 'Every day at')
    assert.equal(
      scheduleLeadIn({ kind: 'weekly', hour: 9, minute: 0, dow: 1 }),
      'Every week on Monday at',
    )
  })
})

describe('format helpers', () => {
  it('pads time', () => {
    assert.equal(formatTime(4, 0), '04:00')
    assert.equal(formatTime(15, 30), '15:30')
  })

  it('formats timezone offset', () => {
    const label = formatTimezoneOffset(new Date('2026-07-24T12:00:00'))
    assert.ok(label.startsWith('GMT+') || label.startsWith('GMT-'))
  })

  it('computes next run', () => {
    const from = new Date('2026-07-24T12:00:00')
    const ts = nextRunAt('0 4 * * *', from)
    assert.ok(typeof ts === 'number')
    assert.ok(ts > from.getTime())
  })

  it('defaults once-at to the next local hour', () => {
    assert.equal(defaultOnceAtCron(new Date('2026-08-15T02:40:00')), '0 3 * * *')
    assert.equal(defaultOnceAtCron(new Date('2026-08-15T23:10:00')), '0 0 * * *')
  })

  it('formats an absolute one-shot without calculating another cron occurrence', () => {
    const label = formatScheduledRunLabel(new Date('2026-08-15T03:00:00').getTime())
    assert.match(label ?? '', /^Scheduled /)
    assert.match(label ?? '', /GMT[+-]/)
  })
})
