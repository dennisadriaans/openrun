import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_RUN_TIMEOUT_MS,
  MAX_RUN_TIMEOUT_MS,
  MIN_RUN_TIMEOUT_MS,
  assertRunTimeoutMinutes,
  resolveRunTimeoutMs,
  runTimedOutMessage,
} from './runBudget.ts'

describe('resolveRunTimeoutMs', () => {
  it('falls back to the default for unset / zero / negative', () => {
    assert.equal(resolveRunTimeoutMs(0), DEFAULT_RUN_TIMEOUT_MS)
    assert.equal(resolveRunTimeoutMs(null), DEFAULT_RUN_TIMEOUT_MS)
    assert.equal(resolveRunTimeoutMs(undefined), DEFAULT_RUN_TIMEOUT_MS)
    assert.equal(resolveRunTimeoutMs(-5), DEFAULT_RUN_TIMEOUT_MS)
    assert.equal(resolveRunTimeoutMs(Number.NaN), DEFAULT_RUN_TIMEOUT_MS)
  })

  it('clamps a stored value into range rather than refusing it', () => {
    assert.equal(resolveRunTimeoutMs(1_000), MIN_RUN_TIMEOUT_MS)
    assert.equal(resolveRunTimeoutMs(MAX_RUN_TIMEOUT_MS * 10), MAX_RUN_TIMEOUT_MS)
  })

  it('passes an in-range value through', () => {
    assert.equal(resolveRunTimeoutMs(5 * 60_000), 5 * 60_000)
  })
})

describe('assertRunTimeoutMinutes', () => {
  it('treats empty / zero as "use the default"', () => {
    assert.equal(assertRunTimeoutMinutes(0), 0)
    assert.equal(assertRunTimeoutMinutes(null), 0)
    assert.equal(assertRunTimeoutMinutes(undefined), 0)
  })

  it('converts minutes to milliseconds', () => {
    assert.equal(assertRunTimeoutMinutes(15), 15 * 60_000)
  })

  it('rejects out-of-range minutes instead of silently clamping', () => {
    assert.throws(() => assertRunTimeoutMinutes(0.5), /must be between/)
    assert.throws(() => assertRunTimeoutMinutes(60 * 24), /must be between/)
  })
})

describe('runTimedOutMessage', () => {
  it('states the budget in minutes', () => {
    assert.match(runTimedOutMessage(30 * 60_000), /30-minute budget/)
  })
})
