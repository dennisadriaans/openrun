/**
 * In-process pub/sub for app-wide run activity (list pages).
 *
 * Complements per-run tails in `runLive.ts`: dashboard / run history only need
 * coarse "a run started or finished" signals, not every log chunk.
 */
import { SERVER_PING_MS } from '../lib/liveStream.ts'
import type { ActivityLiveEvent } from '../lib/activityLive'

export type { ActivityLiveEvent }
export { SERVER_PING_MS }

type Listener = (event: ActivityLiveEvent) => void

const listeners = new Set<Listener>()

export function subscribeActivityLive(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function publishActivityLive(event: ActivityLiveEvent): void {
  if (listeners.size === 0) return
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // A bad subscriber must not break the run or other tails.
    }
  }
}

export function activityLiveSubscriberCount(): number {
  return listeners.size
}

/**
 * Build an SSE ReadableStream for app activity. Sends `hello`, then
 * `run_changed` frames, with periodic `ping` heartbeats.
 */
export function createActivityLiveSseStream(opts: {
  signal: AbortSignal
  pingMs?: number
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const pingMs = opts.pingMs ?? SERVER_PING_MS
  let cleanup: (() => void) | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (event: ActivityLiveEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          cleanup?.()
        }
      }

      cleanup = () => {
        if (closed) return
        closed = true
        clearInterval(ping)
        unsub()
        opts.signal.removeEventListener('abort', onAbort)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      const onAbort = () => cleanup?.()
      const unsub = subscribeActivityLive(send)
      const ping = setInterval(() => send({ type: 'ping' }), pingMs)

      opts.signal.addEventListener('abort', onAbort)
      send({ type: 'hello' })

      if (opts.signal.aborted) cleanup()
    },
    cancel() {
      // A disconnected response can cancel its reader without aborting the
      // Request signal. Treat both notifications as authoritative teardown.
      cleanup?.()
    },
  })
}
