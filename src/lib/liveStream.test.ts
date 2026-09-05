import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock, test } from 'node:test'
import { SERVER_PING_MS as activityPing } from '../server/activityLive.ts'
import { SERVER_PING_MS as runPing } from '../server/runLive.ts'
import {
  isStale,
  liveStreamsSnapshot,
  nextReconnectDelay,
  openLiveStream,
  SERVER_PING_MS,
  STALE_AFTER_MS,
} from './liveStream.ts'
import type { LiveStreamHandle } from './liveStream.ts'

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

class FakeEventSource {
  static sockets: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false

  constructor(_path: string) {
    FakeEventSource.sockets.push(this)
  }

  close() {
    this.closed = true
  }
}

describe('live stream recovery', () => {
  let handle: LiveStreamHandle
  let original: PropertyDescriptor | undefined
  let health: boolean[]
  let resumes: number

  beforeEach(() => {
    mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'], now: 1_000 })
    original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource,
    })
    FakeEventSource.sockets = []
    health = []
    resumes = 0
    handle = openLiveStream({
      id: 'test',
      label: 'Test stream',
      path: '/stream',
      onHealthyChange: (value) => health.push(value),
      onMessage: () => false,
      onResume: () => resumes++,
    })
  })

  afterEach(() => {
    handle.close()
    if (original) Object.defineProperty(globalThis, 'EventSource', original)
    else Reflect.deleteProperty(globalThis, 'EventSource')
    mock.timers.reset()
  })

  it('retries a connection that never opens or reports an error', () => {
    const first = FakeEventSource.sockets[0]!
    mock.timers.tick(STALE_AFTER_MS + 5_000)
    assert.equal(first.closed, true)
    mock.timers.tick(2_000)
    assert.equal(FakeEventSource.sockets.length, 2)
    assert.equal(liveStreamsSnapshot()[0]!.healthy, false)
  })

  it('also times out a stalled reconnect without reusing the old heartbeat', () => {
    FakeEventSource.sockets[0]!.onopen!()
    mock.timers.tick(20_000)
    handle.reconnect()
    const second = FakeEventSource.sockets[1]!
    mock.timers.tick(STALE_AFTER_MS)
    assert.equal(second.closed, false)
    mock.timers.tick(5_000)
    assert.equal(second.closed, true)
    mock.timers.tick(2_000)
    FakeEventSource.sockets.at(-1)!.onopen!()
    assert.equal(resumes, 1)
    assert.deepEqual(health, [true, false, true])
  })

  it('keeps a stream alive while heartbeats arrive and recovers after silence', () => {
    const first = FakeEventSource.sockets[0]!
    first.onopen!()
    for (let i = 0; i < 5; i++) {
      mock.timers.tick(15_000)
      first.onmessage!({ data: '{"type":"ping"}' })
    }
    assert.equal(first.closed, false)
    mock.timers.tick(STALE_AFTER_MS + 5_000)
    assert.equal(first.closed, true)
    assert.equal(health.at(-1), false)
  })

  it('cancels pending retries and ignores late socket events after closing', () => {
    const first = FakeEventSource.sockets[0]!
    const lateOpen = first.onopen!
    first.onerror!()
    handle.close()
    lateOpen()
    mock.timers.tick(60_000)
    assert.equal(FakeEventSource.sockets.length, 1)
    assert.deepEqual(liveStreamsSnapshot(), [])
    assert.equal(health.includes(true), false)
  })
})
