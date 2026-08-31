/**
 * Queued follow-ups, stacked on top of the composer.
 *
 * Messages typed while the agent is working wait here and become their own
 * turns in order. Two escapes: Send now interrupts the agent so the queue
 * starts immediately, and a stopped turn leaves the queue paused with a Send
 * of its own rather than throwing the text away.
 */
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import type { QueuedMessage } from '../../lib/messageQueue'
import { queueStatusNote, queuedMessagesLabel } from '../../lib/messageQueue'

export function QueuedMessages({
  queued,
  running,
  busy = false,
  onSendNow,
  onDrop,
  onClear,
}: {
  queued: QueuedMessage[]
  /** The run is still working, so the queue drains on its own. */
  running: boolean
  /** An action is in flight — keeps double-taps from stacking. */
  busy?: boolean
  onSendNow: () => void
  onDrop: (id: string) => void
  onClear: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  if (queued.length === 0) return null

  return (
    <div className="chat-files-glass rounded-t-[16px] border border-b-0 border-border">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/60"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="shrink-0">{queuedMessagesLabel(queued.length)}</span>
          <span className="truncate text-[12px] font-normal text-muted-foreground">
            · {queueStatusNote({ depth: queued.length, running })}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="h-6 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSendNow}
            disabled={busy}
            title={
              running ? 'Interrupt the agent and send these now' : 'Send the queued messages now'
            }
            className="h-6 rounded-md border border-border bg-secondary/80 px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? 'Send now' : 'Send'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="scroll-thin max-h-[min(28vh,14rem)] space-y-px overflow-y-auto px-1.5 pb-1.5">
          {queued.map((message, index) => (
            <div
              key={message.id}
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] leading-5 hover:bg-secondary/60"
            >
              <span className="mono flex size-5 shrink-0 items-center justify-center text-[11px] text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/82" title={message.prompt}>
                {message.prompt}
              </span>
              <button
                type="button"
                onClick={() => onDrop(message.id)}
                disabled={busy}
                aria-label="Remove queued message"
                title="Remove"
                className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
