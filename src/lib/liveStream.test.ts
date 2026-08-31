import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SERVER_PING_MS as activityPing } from '../server/activityLive.ts'
import { SERVER_PING_MS as runPing } from '../server/runLive.ts'
import { isStale, nextReconnectDelay, SERVER_PING_MS, STALE_AFTER_MS } from './liveStream.ts'

test('the watchdog window is derived from the shared ping period', () => {
  assert.equal(STALE_AFTER_MS, SERVER_PING_MS * 3 - 5_000)
})

test('both SSE factories re-export the same ping period', () => {
  assert.equal(runPing, SERVER_PING_MS)
  assert.equal(activityPing, SERVER_PING_MS)
})

test('isStale is false until silence exceeds STALE_AFTER_MS', () => {
  assert.equal(isStale(null, 50_000), false)
  assert.equal(isStale(0, STALE_AFTER_MS), false)
  assert.equal(isStale(0, STALE_AFTER_MS + 1), true)
})

test('nextReconnectDelay stays inside ±25% jitter of the exponential base', () => {
  const baseMs = 1_000
  const maxMs = 15_000
  for (let attempt = 1; attempt <= 12; attempt++) {
    const base = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs)
    const delay = nextReconnectDelay(attempt)
    assert.ok(delay >= Math.round(base * 0.75), `attempt ${attempt}: ${delay} < 0.75*${base}`)
    assert.ok(delay <= Math.round(base * 1.25), `attempt ${attempt}: ${delay} > 1.25*${base}`)
  }
})
