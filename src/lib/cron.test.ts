import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertValidCron, invalidCronMessage, isValidCron, normalizeCron } from './cron.ts'
import { CRON_PRESETS, describeCron } from './format.ts'

describe('normalizeCron', () => {
  it('trims whitespace', () => {
    assert.equal(normalizeCron('  0 9 * * 1-5  '), '0 9 * * 1-5')
  })
})

describe('isValidCron', () => {
  it('treats empty as valid (manual-only)', () => {
    assert.equal(isValidCron(''), true)
    assert.equal(isValidCron('   '), true)
  })

  it('accepts every UI cron preset', () => {
    for (const preset of CRON_PRESETS) {
      assert.equal(isValidCron(preset.value), true, preset.label)
    }
  })

  it('accepts common 5-field schedules', () => {
    for (const expr of [
      '* * * * *',
      '*/5 * * * *',
      '0 * * * *',
      '0 9 * * 1-5',
      '0 9 * * MON',
      '0 9 * * mon-fri',
      '0 9 * JAN *',
      '0 8 * * 1-5',
      '30 18 1,15 * *',
      '1-5/2 * * * *',
      '*/60 * * * *',
    ]) {
      assert.equal(isValidCron(expr), true, expr)
    }
  })

  it('accepts 6-field expressions with seconds', () => {
    assert.equal(isValidCron('0 0 9 * * 1-5'), true)
  })

  it('rejects malformed expressions', () => {
    for (const expr of [
      'every day',
      '0 9 * *',
      '0 9 * * * * *',
      '60 9 * * *',
      '0 25 * * *',
      '0 9 * * 8',
      '0-99 * * * *',
      '0 9 * * MONDAY',
      '@daily',
      '0 9 * * 1/2',
      '0 9 * * mon/2',
    ]) {
      assert.equal(isValidCron(expr), false, expr)
    }
  })

  it('rejects inverted numeric ranges', () => {
    assert.equal(isValidCron('5-1 * * * *'), false)
  })
})

describe('assertValidCron', () => {
  it('allows empty and valid expressions', () => {
    assert.doesNotThrow(() => assertValidCron(''))
    assert.doesNotThrow(() => assertValidCron('0 9 * * 1-5'))
  })

  it('throws an actionable message for invalid expressions', () => {
    assert.throws(
      () => assertValidCron('every day'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.equal(err.message, invalidCronMessage('every day'))
        assert.match(err.message, /5-field schedule/)
        assert.match(err.message, /manual-only/)
        return true
      },
    )
  })
})

describe('describeCron', () => {
  it('labels empty as manual-only', () => {
    assert.equal(describeCron(''), 'Manual only')
  })

  it('labels invalid expressions instead of echoing or mis-describing them', () => {
    assert.equal(describeCron('every day'), 'Invalid schedule')
    assert.equal(describeCron('60 9 * * *'), 'Invalid schedule')
  })

  it('still describes common valid presets', () => {
    assert.equal(describeCron('0 9 * * *'), 'Daily at 09:00')
    assert.equal(describeCron('* * * * *'), 'Every minute')
  })
})
