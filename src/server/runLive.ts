/**
 * In-process pub/sub for live run tails.
 *
 * The executor publishes as stdout/events/status change; the SSE route
 * (`/api/runs/$runId/stream`) subscribes and pushes frames to open browsers.
 * One local user, one Node process — no Redis, no cross-machine fan-out.
 */
import type { RunLiveEvent } from '../lib/runLive'

export type { RunLiveEvent }

type Listener = (event: RunLiveEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribeRunLive(runId: string, listener: Listener): () => void {
  let set = listeners.get(runId)
  if (!set) {
    set = new Set()
    listeners.set(runId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(runId)
  }
}

export function publishRunLive(runId: string, event: RunLiveEvent): void {
  const set = listeners.get(runId)
  if (!set || set.size === 0) return
  for (const listener of [...set]) {
    try {
      listener(event)
    } catch {
      // A bad subscriber must not break the run or other tails.
    }
  }
}

/** How many open SSE (or other) subscribers are watching this run. */
export function runLiveSubscriberCount(runId: string): number {
  return listeners.get(runId)?.size ?? 0
}

const DEFAULT_PING_MS = 15_000

/**
 * Build an SSE ReadableStream for one run. Sends `hello`, then live events,
 * with periodic `ping` heartbeats. Abort (client disconnect) tears down the
 * subscription cleanly.
 */
export function createRunLiveSseStream(
  runId: string,
  opts: { status: string; signal: AbortSignal; pingMs?: number },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const pingMs = opts.pingMs ?? DEFAULT_PING_MS

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (event: RunLiveEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          cleanup()
        }
      }

      const cleanup = () => {
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

      const onAbort = () => cleanup()
      const unsub = subscribeRunLive(runId, send)
      const ping = setInterval(() => send({ type: 'ping' }), pingMs)

      opts.signal.addEventListener('abort', onAbort)
      send({ type: 'hello', runId, status: opts.status })

      if (opts.signal.aborted) cleanup()
    },
    cancel() {
      // Reader cancelled — AbortSignal may already have fired; no-op safe.
    },
  })
}
