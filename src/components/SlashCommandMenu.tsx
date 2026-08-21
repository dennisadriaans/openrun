/**
 * The `/` menu that opens above a composer.
 *
 * Presentational only: the input that owns the textarea decides when to open
 * it, which row is active, and what a pick does. Keyboard navigation lives
 * there too, because the arrow keys have to be intercepted before the textarea
 * moves the caret.
 */
import { useEffect, useRef } from 'react'
import { slashSourceLabel, type SlashCommand } from '../lib/slashCommands'

export function SlashCommandMenu({
  commands,
  activeIndex,
  note,
  onPick,
}: {
  commands: SlashCommand[]
  activeIndex: number
  /** Caveat about how this runtime treats commands, when there is one. */
  note?: string
  onPick: (command: SlashCommand) => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (commands.length === 0) return null

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1.5">
      <div className="mx-auto w-full overflow-hidden rounded-[14px] border border-border bg-elevated shadow-lg">
        <ul className="scroll-thin max-h-64 overflow-y-auto py-1">
          {commands.map((command, index) => (
            <li key={`${command.source}:${command.name}`}>
              <button
                ref={index === activeIndex ? activeRef : undefined}
                type="button"
                // The textarea must keep focus, so the click cannot be allowed
                // to blur it first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(command)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${
                  index === activeIndex ? 'bg-hover' : 'hover:bg-hover/60'
                }`}
              >
                <span className="shrink-0 mono text-ui-sm text-foreground">/{command.name}</span>
                {command.argumentHint ? (
                  <span className="shrink-0 mono text-ui-xs text-tier-quaternary">
                    {command.argumentHint}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-ui-sm text-tier-tertiary">
                  {command.description}
                </span>
                <span className="shrink-0 text-ui-xs text-tier-quaternary">
                  {slashSourceLabel(command.source)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {note ? (
          <div className="border-t border-border px-3 py-1.5 text-ui-xs text-tier-quaternary">
            {note}
          </div>
        ) : null}
      </div>
    </div>
  )
}
