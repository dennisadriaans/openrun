/**
 * "Working for 12s · Editing Chat.tsx" — the transcript's only live state.
 *
 * The timer writes its own text node once a second instead of re-rendering,
 * so a long turn does not commit React work while output is streaming in.
 * Pattern taken from the t3code timeline (MIT, T3 Tools Inc.).
 */
import { useEffect, useRef } from 'react'
import { elapsedLabel } from '../../lib/format'

function Timer({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const write = () => {
      if (ref.current) ref.current.textContent = elapsedLabel(startedAt)
    }
    write()
    const id = setInterval(write, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  return (
    <span ref={ref} className="tabular-nums">
      {elapsedLabel(startedAt)}
    </span>
  )
}

export function WorkingIndicator({
  startedAt,
  step,
  verb = 'Working',
}: {
  /** Turn start; omitted when unknown, which drops the elapsed timer. */
  startedAt?: number
  /** What the agent is doing right now, e.g. the newest tool call. */
  step?: string
  /** Overrides "Working" for phases that are not the agent typing. */
  verb?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 pt-1 text-[11px] text-muted-foreground/70 tabular-nums">
      <span className="inline-flex shrink-0 items-center gap-[3px]">
        <span className="h-1 w-1 animate-status-pulse rounded-full bg-muted-foreground/30" />
        <span className="h-1 w-1 animate-status-pulse rounded-full bg-muted-foreground/30 [animation-delay:200ms]" />
        <span className="h-1 w-1 animate-status-pulse rounded-full bg-muted-foreground/30 [animation-delay:400ms]" />
      </span>
      <span className="shrink-0">
        {startedAt ? (
          <>
            {verb} for <Timer startedAt={startedAt} />
          </>
        ) : (
          `${verb}…`
        )}
      </span>
      {step ? <span className="min-w-0 truncate text-muted-foreground/55">· {step}</span> : null}
    </div>
  )
}
