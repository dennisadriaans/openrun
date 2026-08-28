/**
 * "Working for 12s · Editing Chat.tsx" — the transcript's only live state.
 *
 * The timer writes its own text node once a second instead of re-rendering,
 * so a long turn does not commit React work while output is streaming in.
 * Pattern taken from the t3code timeline (MIT, T3 Tools Inc.).
 */
import { useEffect, useRef } from 'react'
import { elapsedLabel } from '../../lib/format'
import { orbVerb, type ActivityOrbState } from '../../lib/orbState'
import type { TurnActivityStep } from '../../lib/turnActivity'
import { ActivityOrb } from './ActivityOrb'

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
  steps,
  verb,
  orb = 'working',
}: {
  /** Turn start; omitted when unknown, which drops the elapsed timer. */
  startedAt?: number
  /** What the agent is doing right now, e.g. the newest tool call. */
  step?: string
  /** Concrete thoughts and tool calls reported so far in this turn. */
  steps?: TurnActivityStep[]
  /** Overrides the orb's default verb for phases that are not the agent typing. */
  verb?: string
  orb?: ActivityOrbState
}) {
  const label = verb ?? orbVerb(orb)
  const logRef = useRef<HTMLDivElement>(null)
  const lastStep = steps?.at(-1)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [steps?.length, lastStep?.status])

  return (
    <div className="min-w-0 pt-1 text-[11px] text-muted-foreground/70 tabular-nums">
      <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
        <ActivityOrb state={orb} live />
        <span className="shrink-0">
          {startedAt ? (
            <>
              {label} for <Timer startedAt={startedAt} />
            </>
          ) : (
            `${label}…`
          )}
        </span>
        {step ? <span className="min-w-0 truncate text-muted-foreground/55">· {step}</span> : null}
      </div>
      {steps && steps.length > 0 ? (
        <div
          ref={logRef}
          role="log"
          aria-label="Live activity"
          aria-live="polite"
          className="scroll-thin mt-2 max-h-44 overflow-y-auto rounded-lg border border-border bg-chrome/65 px-3 py-2"
        >
          <ol className="space-y-1.5">
            {steps.map((item) => (
              <li key={item.key} className="flex min-w-0 items-start gap-2 leading-relaxed">
                <span
                  aria-hidden="true"
                  className={`mt-px w-3 shrink-0 text-center ${
                    item.status === 'failed'
                      ? 'text-danger'
                      : item.status === 'completed'
                        ? 'text-muted-foreground/50'
                        : 'text-foreground'
                  }`}
                >
                  {item.status === 'failed' ? '×' : item.status === 'completed' ? '✓' : '⟳'}
                </span>
                <span
                  className={`min-w-0 break-words mono ${
                    item.status === 'completed'
                      ? 'text-muted-foreground/55'
                      : item.status === 'failed'
                        ? 'text-danger'
                        : 'text-muted-foreground'
                  }`}
                >
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
