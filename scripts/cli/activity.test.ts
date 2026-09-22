import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { SERVER_PING_MS, STALE_AFTER_MS } from '../../src/lib/liveStream.ts'
import { watchActivity } from './activity.ts'

test('remote activity authenticates, handles split frames and closes when leaving Home', async (t) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let signal!: AbortSignal
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://openrun.example/api/activity/stream')
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer test-token')
    signal = init.signal!
    signal.addEventListener('abort', () => controller.close(), { once: true })
    return new Response(stream)
  })
  const health: boolean[] = []
  let changes = 0
  const stop = watchActivity({
    url: 'https://openrun.example',
    token: 'test-token',
    onChange: () => {
      changes++
    },
    onHealthy: (value) => health.push(value),
  })
  t.after(stop)
  const send = async (frame: string) => {
    controller.enqueue(new TextEncoder().encode(frame))
    await setImmediate()
  }
  await send('data: {"type":"hel')
  assert.equal(changes, 0)
  await send('lo"}\n\ndata: {"type":"ping"}\n\n')
  assert.equal(changes, 1)
  assert.deepEqual(health, [false, true])
  await send('data: {"type":"run_changed","runId":"run-1"}\n\n')
  assert.equal(changes, 2)
  stop()
  await setImmediate()
  assert.equal(signal.aborted, true)
  assert.deepEqual(health, [false, true])
})

test('a silent activity stream becomes unhealthy even if its socket stays open', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval', 'setTimeout'] })
  let signal!: AbortSignal
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    signal = init.signal!
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"hello"}\n\n'))
          signal.addEventListener('abort', () => controller.close(), { once: true })
        },
      }),
    )
  })
  const health: boolean[] = []
  const stop = watchActivity({
    url: 'https://openrun.example',
    onChange() {},
    onHealthy: (value) => health.push(value),
  })
  t.after(stop)
  await setImmediate()
  assert.deepEqual(health, [false, true])
  t.mock.timers.tick(STALE_AFTER_MS + SERVER_PING_MS)
  assert.deepEqual(health, [false, true, false])
  assert.equal(signal.aborted, true)
  stop()
  await setImmediate()
})
