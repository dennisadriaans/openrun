/**
 * The `$` menu that opens above a composer — Codex's plugin mention.
 *
 * Presentational only, like `SlashCommandMenu`: the input that owns the
 * textarea decides when it opens, which row is active, and what a pick does.
 */
import { useEffect, useRef } from 'react'
import { pluginCapabilityLabel, type AgentPlugin } from '../lib/plugins'

export function PluginMentionMenu({
  plugins,
  activeIndex,
  note,
  onPick,
}: {
  plugins: AgentPlugin[]
  activeIndex: number
  /** Caveat about how this runtime treats a mention, when there is one. */
  note?: string
  onPick: (plugin: AgentPlugin) => void
}) {
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (plugins.length === 0) return null

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1.5">
      <div className="mx-auto w-full overflow-hidden rounded-[14px] border border-border bg-elevated shadow-lg">
        <ul className="scroll-thin max-h-64 overflow-y-auto py-1">
          {plugins.map((plugin, index) => (
            <li key={`${plugin.host}:${plugin.name}`}>
              <button
                ref={index === activeIndex ? activeRef : undefined}
                type="button"
                // The textarea must keep focus, so the click cannot be allowed
                // to blur it first.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(plugin)}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left transition-colors ${
                  index === activeIndex ? 'bg-hover' : 'hover:bg-hover/60'
                }`}
              >
                <span className="shrink-0 mono text-ui-sm text-foreground">${plugin.name}</span>
                <span className="min-w-0 flex-1 truncate text-ui-sm text-tier-tertiary">
                  {plugin.description || plugin.displayName}
                </span>
                <span className="shrink-0 text-ui-xs text-tier-quaternary">
                  {plugin.capabilities.map(pluginCapabilityLabel).join(' · ')}
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
