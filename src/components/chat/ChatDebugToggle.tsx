/**
 * Debug view toggle. On, the transcript is the raw terminal one — mono, full
 * width, `●`/`⎿` markers, shell output printed in color inline; off, it is the
 * ordinary chat UI. Lives in the run top bar because the choice is global, not
 * part of a run's settings.
 */
import { Bug } from 'lucide-react'
import { useChatTheme } from './ChatThemeProvider'

export function ChatDebugToggle() {
  const { theme, setTheme } = useChatTheme()
  const debug = theme === 'terminal'
  const label = debug ? 'Debug view on — terminal transcript' : 'Debug view'

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={debug}
      title={label}
      onClick={() => setTheme(debug ? 'openrun' : 'terminal')}
      className={`inline-flex size-7 items-center justify-center rounded-md transition-colors ${
        debug
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Bug className="size-3.5" />
    </button>
  )
}
