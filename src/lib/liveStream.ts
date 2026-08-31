/**
 * Browser-side SSE connection manager shared by every live stream.
 *
 * `EventSource` only reports failures it can see. A socket that dies while the
 * laptop sleeps, the Wi-Fi changes, or the dev server restarts stays
 * `readyState === OPEN` and never fires `error`, so a naive hook keeps
 * reporting the stream as healthy — and every `refetchInterval: healthy ?
 * false : ms` in `queries.ts` stays switched off. The app then looks frozen
 * until a manual reload.
 *
 * So liveness is decided here, not by the socket: the server heartbeats, and a
 * stream that goes quiet past `STALE_AFTER_MS` is torn down and redialled.
 * Wake-up signals (tab visible, window focused, network back) bypass the
 * backoff, because those are exactly the moments a zombie socket surfaces.
 */

/** Server heartbeat period. Both SSE factories import this; do not duplicate. */
export const SERVER_PING_MS = 15_000
/** Silence past this means the socket is dead even if the browser disagrees. */
export const STALE_AFTER_MS = SERVER_PING_MS * 3 - 5_000
const WATCHDOG_TICK_MS = 5_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

export type LiveStreamPhase = 'connecting' | 'open' | 'reconnecting' | 'closed'

export type LiveStreamSnapshot = {
  id: string
  label: string
  path: string
  phase: LiveStreamPhase
  healthy: boolean
  openedAt: number | null
  /** Any frame, heartbeats included — what the watchdog judges. */
  lastFrameAt: number | null
  /** Last frame that actually carried data. */
  lastDataAt: number | null
  attempts: number
  reconnects: number
  lastError: string | null
}

export type LiveStreamHandle = {
  /** Redial now, ignoring backoff. */
  reconnect: () => void
  close: () => void
}

export type LiveStreamOptions = {
  /** Stable across remounts; identifies the row in the dev overlay. */
  id: string
  label: string
  path: string
  /** Return true when the frame carried data rather than a heartbeat. */
  onMessage: (data: string) => boolean
  onHealthyChange: (healthy: boolean) => void
  /**
   * Fired when a stream reopens after having dropped. Frames published during
   * the gap are gone for good, so the caller refetches instead of trusting the
   * cache it was patching in place.
   */
  onResume?: () => void
}

/** Exponential backoff with ±25% jitter so repeated failures don't sync up. */
export function nextReconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_MAX_MS)
  return Math.round(base * (0.75 + Math.random() * 0.5))
}

/** True when a stream that believes it is open has gone quiet too long. */
export function isStale(lastFrameAt: number | null, now: number): boolean {
  if (lastFrameAt === null) return false
  return now - lastFrameAt > STALE_AFTER_MS
}

// --- Registry (dev overlay reads this; nothing in the app depends on it) ----

const entries = new Map<string, LiveStreamSnapshot>()
const handles = new Map<string, LiveStreamHandle>()
const registryListeners = new Set<() => void>()
let cachedSnapshot: readonly LiveStreamSnapshot[] = []

function publishRegistry(): void {
  cachedSnapshot = [...entries.values()]
  for (const listener of [...registryListeners]) listener()
}

export function subscribeLiveStreams(listener: () => void): () => void {
  registryListeners.add(listener)
  return () => {
    registryListeners.delete(listener)
  }
}

export function liveStreamsSnapshot(): readonly LiveStreamSnapshot[] {
  return cachedSnapshot
}

/** Redial every open stream now. Used by the dev overlay's reconnect button. */
export function reconnectAllLiveStreams(): void {
  for (const handle of [...handles.values()]) handle.reconnect()
}

// --- Wake-up signals -------------------------------------------------------

type Waker = () => void
const wakers = new Set<Waker>()
let wakeListenersBound = false

function wakeAll(): void {
  for (const waker of [...wakers]) waker()
}

function bindWakeListeners(): void {
  if (wakeListenersBound || typeof window === 'undefined') return
  wakeListenersBound = true
  // Background tabs get their timers throttled or frozen outright, so the
  // watchdog cannot be the thing that notices a resume — these events are.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wakeAll()
  })
  window.addEventListener('focus', wakeAll)
  window.addEventListener('online', wakeAll)
  window.addEventListener('pageshow', wakeAll)
}

// --- Connection ------------------------------------------------------------

export function openLiveStream(opts: LiveStreamOptions): LiveStreamHandle {
  const snapshot: LiveStreamSnapshot = {
    id: opts.id,
    label: opts.label,
    path: opts.path,
    phase: 'connecting',
    healthy: false,
    openedAt: null,
    lastFrameAt: null,
    lastDataAt: null,
    attempts: 0,
    reconnects: 0,
    lastError: null,
  }
  entries.set(opts.id, snapshot)
  publishRegistry()

  let closed = false
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let watchdogTimer: ReturnType<typeof setInterval> | null = null
  let hasBeenOpen = false

  const patch = (next: Partial<LiveStreamSnapshot>) => {
    Object.assign(snapshot, next)
    entries.set(opts.id, { ...snapshot })
    publishRegistry()
  }

  const setHealthy = (healthy: boolean) => {
    if (snapshot.healthy === healthy) return
    patch({ healthy })
    opts.onHealthyChange(healthy)
  }

  const teardownSocket = () => {
    if (!es) return
    // Drop the handlers first: `close()` on a live socket can still deliver a
    // trailing `error`, which would otherwise queue a second reconnect.
    es.onopen = null
    es.onmessage = null
    es.onerror = null
    es.close()
    es = null
  }

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return
    patch({ phase: 'reconnecting', attempts: snapshot.attempts + 1 })
    const delay = nextReconnectDelay(snapshot.attempts)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay)
  }

  const drop = (reason: string) => {
    if (closed) return
    setHealthy(false)
    patch({ lastError: reason, openedAt: null })
    teardownSocket()
    scheduleReconnect()
  }

  const connect = () => {
    if (closed) return
    teardownSocket()
    patch({ phase: hasBeenOpen ? 'reconnecting' : 'connecting' })

    let socket: EventSource
    try {
      socket = new EventSource(opts.path)
    } catch (err) {
      drop(err instanceof Error ? err.message : String(err))
      return
    }
    es = socket

    socket.onopen = () => {
      if (closed || es !== socket) return
      const resumed = hasBeenOpen
      hasBeenOpen = true
      patch({
        phase: 'open',
        openedAt: Date.now(),
        lastFrameAt: Date.now(),
        attempts: 0,
        lastError: null,
        reconnects: resumed ? snapshot.reconnects + 1 : snapshot.reconnects,
      })
      setHealthy(true)
      if (resumed) opts.onResume?.()
    }

    socket.onmessage = (msg) => {
      if (closed || es !== socket) return
      const now = Date.now()
      const carriedData = opts.onMessage(String(msg.data))
      patch({ lastFrameAt: now, ...(carriedData ? { lastDataAt: now } : {}) })
      setHealthy(true)
    }

    socket.onerror = () => {
      if (closed || es !== socket) return
      drop('stream error')
    }
  }

  /** Redial immediately and forget the backoff — a human is waiting. */
  const reconnectNow = () => {
    if (closed) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    setHealthy(false)
    patch({ attempts: 0 })
    connect()
  }

  const check = () => {
    if (closed) return
    if (es && snapshot.phase === 'open' && isStale(snapshot.lastFrameAt, Date.now())) {
      patch({ lastError: 'no heartbeat' })
      reconnectNow()
      return
    }
    if (!es && !reconnectTimer) connect()
  }

  const onWake = () => {
    if (closed) return
    // A socket the browser still calls OPEN is exactly what goes unnoticed
    // across a sleep, so re-dial on any doubt rather than trusting readyState.
    if (snapshot.phase === 'open' && isStale(snapshot.lastFrameAt, Date.now())) {
      patch({ lastError: 'no heartbeat' })
      reconnectNow()
      return
    }
    if (snapshot.phase !== 'open') reconnectNow()
  }

  bindWakeListeners()
  wakers.add(onWake)
  watchdogTimer = setInterval(check, WATCHDOG_TICK_MS)
  connect()

  const handle: LiveStreamHandle = {
    reconnect: reconnectNow,
    close: () => {
      if (closed) return
      closed = true
      wakers.delete(onWake)
      if (watchdogTimer) clearInterval(watchdogTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      teardownSocket()
      opts.onHealthyChange(false)
      entries.delete(opts.id)
      handles.delete(opts.id)
      publishRegistry()
    },
  }
  handles.set(opts.id, handle)
  return handle
}
