import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ONE_SHOT_GRACE_MS, oneShotDecision } from './oneShotSchedule.ts'

describe('oneShotDecision', () => {
  const now = 1_700_000_000_000

  it('waits until a future absolute time', () => {
    assert.deepEqual(oneShotDecision(now + 60_000, now), { kind: 'wait', delayMs: 60_000 })
  })

  it('catches up a recently missed one-off', () => {
    assert.deepEqual(oneShotDecision(now - ONE_SHOT_GRACE_MS, now), { kind: 'fire' })
  })

  it('marks an old one-off missed instead of moving it to tomorrow', () => {
    assert.deepEqual(oneShotDecision(now - ONE_SHOT_GRACE_MS - 1, now), {
      kind: 'miss',
      lateByMs: ONE_SHOT_GRACE_MS + 1,
    })
  })

  it('rejects a missing absolute time', () => {
    assert.deepEqual(oneShotDecision(0, now), { kind: 'invalid' })
  })
})
