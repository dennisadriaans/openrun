import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XtermTerminal } from '@xterm/xterm'
import { Terminal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 480
const DEFAULT_HEIGHT = 220

type StreamEvent =
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number; signal: number }

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `Terminal request failed (${response.status})`
}

export function TerminalDrawer({
  open,
  height,
  onHeightChange,
  onClose,
  workspaceId,
}: {
  open: boolean
  height: number
  onHeightChange: (h: number) => void
  onClose: () => void
  workspaceId?: string
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const terminalHostRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - event.clientY
      const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta))
      onHeightChange(next)
    },
    [onHeightChange],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [dragging, onPointerMove, onPointerUp])

  useEffect(() => {
    if (!open || !workspaceId || !terminalHostRef.current) return
    setError(null)

    let disposed = false
    let sessionId: string | null = null
    let source: EventSource | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let inputTimer: ReturnType<typeof setTimeout> | null = null
    let pendingInput = ''
    let inputChain = Promise.resolve()
    const terminal = new XtermTerminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      scrollback: 5_000,
      theme: { background: '#101010', foreground: '#d6d6dd', cursor: '#f0f0f0' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(terminalHostRef.current)
    fit.fit()
    terminal.focus()

    const sendInput = () => {
      inputTimer = null
      if (!sessionId || !pendingInput) return
      const data = pendingInput
      pendingInput = ''
      const id = sessionId
      inputChain = inputChain
        .then(async () => {
          const response = await fetch(`/api/terminals/${encodeURIComponent(id)}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: data,
          })
          if (!response.ok) throw new Error(await responseError(response))
        })
        .catch(() => setError('The terminal connection was lost.'))
    }
    const dataDisposable = terminal.onData((data) => {
      pendingInput += data
      if (!inputTimer) inputTimer = setTimeout(sendInput, 8)
    })

    const resize = () => {
      fit.fit()
      if (!sessionId) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        void fetch(`/api/terminals/${encodeURIComponent(sessionId!)}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cols: terminal.cols, rows: terminal.rows }),
        })
      }, 50)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(terminalHostRef.current)

    void fetch('/api/terminals/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, cols: terminal.cols, rows: terminal.rows }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response))
        return response.json() as Promise<{ id: string }>
      })
      .then(({ id }) => {
        if (disposed) {
          void fetch(`/api/terminals/${encodeURIComponent(id)}/`, { method: 'DELETE' })
          return
        }
        sessionId = id
        sendInput()
        source = new EventSource(`/api/terminals/${encodeURIComponent(id)}/stream`)
        source.onmessage = (message) => {
          const event = JSON.parse(message.data) as StreamEvent
          if (event.type === 'data') terminal.write(event.data)
          if (event.type === 'exit') {
            terminal.writeln(`\r\n[process exited with code ${event.exitCode}]`)
            source?.close()
          }
        }
        source.onerror = () => {
          if (!disposed) setError('The terminal connection was lost.')
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      disposed = true
      source?.close()
      observer.disconnect()
      dataDisposable.dispose()
      if (resizeTimer) clearTimeout(resizeTimer)
      if (inputTimer) clearTimeout(inputTimer)
      terminal.dispose()
      if (sessionId) {
        void fetch(`/api/terminals/${encodeURIComponent(sessionId)}/`, {
          method: 'DELETE',
          keepalive: true,
        })
      }
    }
  }, [open, workspaceId])

  if (!open) return null

  const h = height || DEFAULT_HEIGHT
  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-[#101010]"
      style={{ height: h }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={(event) => {
          dragRef.current = { startY: event.clientY, startH: h }
          setDragging(true)
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        className="group flex h-2 cursor-ns-resize items-center justify-center"
      >
        <div className="h-0.5 w-10 rounded-full bg-border transition-colors group-hover:bg-muted-foreground/50" />
      </div>
      <div className="flex items-center gap-2 border-b border-border/60 px-3 pb-1.5">
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Terminal
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/50">
          {error ?? 'interactive shell · active workspace'}
        </span>
        <button
          type="button"
          aria-label="Close terminal"
          title="Close terminal"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {workspaceId ? (
        <div ref={terminalHostRef} className="min-h-0 flex-1 overflow-hidden px-1 py-1" />
      ) : (
        <div className="py-6 text-center text-[12px] text-muted-foreground/50">
          This run has no active workspace.
        </div>
      )}
    </div>
  )
}
