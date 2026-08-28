/**
 * Debug view toggle. On, the transcript is the raw terminal one — mono, full
 * width, `●`/`⎿` markers, shell output printed in color inline; off, it is the
 * ordinary chat UI. Lives in the run top-bar overflow because the choice is
 * global, not part of a run's settings.
 */
import { Bug } from 'lucide-react'
import { useChatTheme } from './ChatThemeProvider'

export function ChatDebugMenuItem() {
  const { theme, setTheme } = useChatTheme()
  const debug = theme === 'terminal'

  return (
    <button
      type="button"
      role="menuitem"
      aria-pressed={debug}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground transition-colors hover:bg-hover"
      onClick={() => setTheme(debug ? 'openrun' : 'terminal')}
    >
      <Bug className="h-3.5 w-3.5" />
      {debug ? 'Debug view on' : 'Debug view'}
    </button>
  )
}
