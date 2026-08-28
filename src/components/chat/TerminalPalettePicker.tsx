/**
 * Which palette the debug transcript paints output with. Shown in the run
 * top-bar overflow while debug is on — it changes nothing in the ordinary UI.
 */
import { Check } from 'lucide-react'
import { TERMINAL_PALETTES } from '../../lib/terminalPalette'
import { useChatTheme } from './ChatThemeProvider'

export function TerminalPaletteMenuItems() {
  const { palette, setPalette } = useChatTheme()

  return (
    <>
      <div className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        Palette
      </div>
      {TERMINAL_PALETTES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="menuitem"
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm transition-colors hover:bg-hover ${
            option.id === palette ? 'text-foreground' : 'text-foreground/85'
          }`}
          onClick={() => setPalette(option.id)}
        >
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.id === palette ? <Check className="h-3.5 w-3.5 shrink-0 opacity-70" /> : null}
        </button>
      ))}
    </>
  )
}
