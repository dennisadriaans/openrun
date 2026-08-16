/**
 * "Worked for 15s" — the one row a finished turn shows in place of its tool
 * calls, thoughts and commentary. Expanding replays the whole turn.
 */
import { ChevronDown, ChevronRight } from 'lucide-react'
import { elapsedLabel } from '../../lib/format'

export function TurnFold({
  startedAt,
  finishedAt,
  cancelled,
  expanded,
  onToggle,
}: {
  startedAt: number
  finishedAt: number | null
  /** A turn the user stopped reads as "You stopped after 15s". */
  cancelled?: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const Icon = expanded ? ChevronDown : ChevronRight
  const duration = finishedAt && finishedAt > startedAt ? elapsedLabel(startedAt, finishedAt) : null
  const label = cancelled
    ? duration
      ? `You stopped after ${duration}`
      : 'You stopped this response'
    : duration
      ? `Worked for ${duration}`
      : 'Worked'

  return (
    <div className="border-b border-border/60 mb-2 pb-2 pt-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        <Icon className="size-3.5" />
      </button>
    </div>
  )
}
