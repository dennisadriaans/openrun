import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'

const MIN_HEIGHT = 120
const MAX_HEIGHT = 480
const DEFAULT_HEIGHT = 220

export function TerminalDrawer({
  open,
  height,
  onHeightChange,
  command,
  stdout,
  stderr,
}: {
  open: boolean
  height: number
  onHeightChange: (h: number) => void
  command: string
  stdout: string
  stderr: string
}) {
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - e.clientY
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

  if (!open) return null

  const log = [stdout, stderr].filter(Boolean).join('\n')
  const h = height || DEFAULT_HEIGHT

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-[color-mix(in_srgb,var(--chrome)_92%,black)]"
      style={{ height: h }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={(e) => {
          dragRef.current = { startY: e.clientY, startH: h }
          setDragging(true)
          e.currentTarget.setPointerCapture?.(e.pointerId)
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
        <span className="text-[10px] text-muted-foreground/50">read-only · interactive PTY soon</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-3 py-2 mono text-[11.5px] leading-relaxed">
        {command ? (
          <div className="mb-2 text-emerald-300/80">
            <span className="text-muted-foreground/60">$ </span>
            {command}
          </div>
        ) : null}
        {log ? (
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">{log.slice(-12000)}</pre>
        ) : (
          <div className="py-6 text-center text-[12px] text-muted-foreground/50">
            No process output yet. Agent stdout/stderr will appear here.
          </div>
        )}
      </div>
    </div>
  )
}
