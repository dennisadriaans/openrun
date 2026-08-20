/**
 * Dev-only live-connection indicator.
 *
 * A zombie SSE socket is invisible from the UI — the page simply stops
 * updating — so dev builds carry a corner badge that says, at a glance, whether
 * the browser is still being fed. Never rendered in a production build:
 * `import.meta.env.DEV` is statically false there and the whole component is
 * dropped.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Activity, RefreshCw, X } from 'lucide-react'

import {
  STALE_AFTER_MS,
  liveStreamsSnapshot,
  reconnectAllLiveStreams,
  subscribeLiveStreams,
  type LiveStreamSnapshot,
} from '../lib/liveStream.ts'
import { useCloudStatus } from '../lib/queries'

const STORAGE_KEY = 'openrun:devtools:live-open'
const EMPTY: readonly LiveStreamSnapshot[] = []

function useLiveStreams(): readonly LiveStreamSnapshot[] {
  return useSyncExternalStore(subscribeLiveStreams, liveStreamsSnapshot, () => EMPTY)
}

/** Re-render on a timer so the "last frame" ages visibly while nothing arrives. */
function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

function age(from: number | null, now: number): string {
  if (from === null) return '—'
  const seconds = Math.max(0, Math.round((now - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h`
}

type Tone = 'ok' | 'warn' | 'bad'

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-rose-400',
}

function streamTone(stream: LiveStreamSnapshot, now: number): Tone {
  if (stream.phase === 'open' && stream.healthy) {
    const quiet = stream.lastFrameAt === null ? 0 : now - stream.lastFrameAt
    return quiet > STALE_AFTER_MS * 0.6 ? 'warn' : 'ok'
  }
  return stream.phase === 'connecting' || stream.phase === 'reconnecting' ? 'warn' : 'bad'
}

function overallTone(streams: readonly LiveStreamSnapshot[], now: number): Tone {
  if (streams.length === 0) return 'warn'
  const tones = streams.map((s) => streamTone(s, now))
  if (tones.includes('bad')) return 'bad'
  return tones.includes('warn') ? 'warn' : 'ok'
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
}

function Row({
  tone,
  name,
  detail,
  meta,
}: {
  tone: Tone
  name: string
  detail: string
  meta?: string
}) {
  return (
    <div className="flex items-baseline gap-2 px-2.5 py-1.5">
      <span className="translate-y-[-1px]">
        <Dot tone={tone} />
      </span>
      <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">{name}</span>
      <span className="shrink-0 font-mono text-[11px] text-tier-secondary">{detail}</span>
      {meta ? <span className="shrink-0 font-mono text-[11px] text-tier-quaternary">{meta}</span> : null}
    </div>
  )
}

function Panel({ streams, now }: { streams: readonly LiveStreamSnapshot[]; now: number }) {
  const { data: cloud } = useCloudStatus()
  const relay = cloud?.relay

  return (
    <div className="mb-1.5 w-72 overflow-hidden rounded-lg border border-border bg-sidebar shadow-lg">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <span className="flex-1 text-ui-sm font-medium text-foreground">Live connections</span>
        <button
          type="button"
          aria-label="Reconnect all streams"
          title="Reconnect all streams"
          onClick={() => reconnectAllLiveStreams()}
          className="rounded p-1 text-tier-quaternary transition-colors hover:bg-hover hover:text-foreground"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      {streams.length === 0 ? (
        <div className="px-2.5 py-2 text-[11px] text-tier-quaternary">No streams open.</div>
      ) : (
        streams.map((stream) => (
          <Row
            key={stream.id}
            tone={streamTone(stream, now)}
            name={stream.label}
            detail={stream.phase === 'open' ? age(stream.lastFrameAt, now) : stream.phase}
            meta={stream.reconnects > 0 ? `↻${stream.reconnects}` : undefined}
          />
        ))
      )}

      <div className="border-t border-border">
        <Row
          tone={!cloud?.signedIn ? 'warn' : relay?.connected ? 'ok' : 'bad'}
          name="Cloud relay"
          detail={
            !cloud?.signedIn ? 'signed out' : relay?.connected ? 'connected' : 'disconnected'
          }
        />
        {relay?.lastError && !relay.connected ? (
          <div className="px-2.5 pb-1.5 text-[11px] text-tier-quaternary">{relay.lastError}</div>
        ) : null}
      </div>

      {streams.some((s) => s.lastError) ? (
        <div className="border-t border-border px-2.5 py-1.5 text-[11px] text-tier-quaternary">
          {streams.find((s) => s.lastError)?.lastError}
        </div>
      ) : null}
    </div>
  )
}

export function DevLiveStatus() {
  if (!import.meta.env.DEV) return null
  return <DevLiveStatusBadge />
}

function DevLiveStatusBadge() {
  const streams = useLiveStreams()
  const now = useTick(1000)
  // Starts closed on both sides of hydration, then adopts the remembered
  // choice — reading localStorage during render would mismatch the SSR shell.
  const [open, setOpen] = useState(false)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') setOpen(true)
    } catch {
      // private mode — the toggle just won't be remembered
    }
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
    } catch {
      // private mode / quota
    }
  }, [open, restored])

  const tone = overallTone(streams, now)

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col items-start">
      <div className="pointer-events-auto">{open ? <Panel streams={streams} now={now} /> : null}</div>
      <button
        type="button"
        aria-label={open ? 'Hide live connection status' : 'Show live connection status'}
        aria-expanded={open}
        title="Live connections (dev only)"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-sidebar px-2 py-1 text-tier-quaternary shadow-md transition-colors hover:text-foreground"
      >
        {open ? <X className="size-3" /> : <Activity className="size-3" />}
        <Dot tone={tone} />
      </button>
    </div>
  )
}
