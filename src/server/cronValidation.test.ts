import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import cron from 'node-cron'
import { isValidCron } from '../lib/cron.ts'
import { assertSchedulableCron, isSchedulableCron } from './cronValidation.ts'

describe('isSchedulableCron', () => {
  it('accepts manual-only and expressions accepted by both layers', () => {
    for (const expr of ['', '0 9 * * *', '*/15 * * * *', '0 0 9 * * 1-5']) {
      assert.equal(isSchedulableCron(expr), true, expr)
    }
  })

  it('never arms an expression node-cron rejects', () => {
    const corpus = [
      '0 9 * * 1/2',
      '0 9 * * mon/2',
      '0 9 * * fri-mon',
      '0 9 * * MONDAY',
      '60 9 * * *',
      'every day',
    ]
    for (const expr of corpus) {
      if (isSchedulableCron(expr)) assert.equal(cron.validate(expr), true, expr)
    }
  })

  it('keeps the scheduler engine as the final write-path authority', () => {
    const expr = '0 9 * * 1/2'
    assert.equal(isValidCron(expr), false)
    assert.equal(cron.validate(expr), false)
    assert.equal(isSchedulableCron(expr), false)
    assert.throws(() => assertSchedulableCron(expr), /Invalid cron expression/)
  })
})
