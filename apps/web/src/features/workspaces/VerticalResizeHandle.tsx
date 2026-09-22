import { useCallback, useEffect, useRef, useState } from 'react'

export function VerticalResizeHandle({
  width,
  onWidthChange,
  min = 280,
  max = 800,
}: {
  width: number
  onWidthChange: (w: number) => void
  min?: number
  max?: number
}) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return
      // Panel is on the right: drag left widens it.
      const delta = dragRef.current.startX - e.clientX
      const cap = Math.min(max, Math.max(min, window.innerWidth - 320))
      const next = Math.min(cap, Math.max(min, dragRef.current.startW + delta))
      onWidthChange(next)
    },
    [max, min, onWidthChange],
  )

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, onPointerMove, onPointerUp])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={(e) => {
        dragRef.current = { startX: e.clientX, startW: width }
        setDragging(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      className="group absolute inset-y-0 -left-1 z-20 flex w-2 cursor-ew-resize items-center justify-center"
    >
      <div
        className={`h-10 w-0.5 rounded-full transition-colors ${
          dragging ? 'bg-muted-foreground/50' : 'bg-transparent group-hover:bg-muted-foreground/40'
        }`}
      />
    </div>
  )
}
