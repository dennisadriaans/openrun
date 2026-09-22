/**
 * Which 16-color palette the debug transcript paints command output with.
 *
 * The colors themselves live in `styles.css` under
 * `[data-chat-theme='terminal'][data-term-palette='…']`; this module owns only
 * the ids, the storage key, and the boot script — the same split as
 * {@link ./chatTheme.ts}, and for the same reason.
 *
 * Browser-safe and dependency-free (`lib/` rule).
 */

export type TerminalPaletteId =
  | 'openrun'
  | 'nord'
  | 'dracula'
  | 'catppuccin-mocha'
  | 'gruvbox-dark'
  | 'one-dark'
  | 'tokyo-night'
  | 'solarized-dark'

export type TerminalPaletteOption = {
  id: TerminalPaletteId
  label: string
  hint: string
}

/**
 * `openrun` is the only one tuned for the app's own chrome and the only one
 * that clears AAA on every slot; the rest are the published schemes verbatim,
 * painted on their own background so they read the way they do in a terminal.
 */
export const TERMINAL_PALETTES: readonly TerminalPaletteOption[] = [
  { id: 'openrun', label: 'Open Run', hint: 'Tuned for this chrome, AAA contrast' },
  { id: 'nord', label: 'Nord', hint: 'Arctic, low contrast' },
  { id: 'dracula', label: 'Dracula', hint: 'High chroma on deep violet' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', hint: 'Pastel, warm dark' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', hint: 'Retro, earthy' },
  { id: 'one-dark', label: 'One Dark', hint: 'Atom’s editor palette' },
  { id: 'tokyo-night', label: 'Tokyo Night', hint: 'Cool blues on near-black' },
  { id: 'solarized-dark', label: 'Solarized Dark', hint: 'The classic, dim by design' },
]

export const TERMINAL_PALETTE_IDS: readonly TerminalPaletteId[] = TERMINAL_PALETTES.map(
  (option) => option.id,
)

export const DEFAULT_TERMINAL_PALETTE: TerminalPaletteId = 'openrun'

export function isTerminalPaletteId(value: unknown): value is TerminalPaletteId {
  return typeof value === 'string' && (TERMINAL_PALETTE_IDS as readonly string[]).includes(value)
}

export const TERMINAL_PALETTE_KEY = 'agentops:termPalette'

export function readTerminalPalette(): TerminalPaletteId {
  try {
    const raw = localStorage.getItem(TERMINAL_PALETTE_KEY)
    return isTerminalPaletteId(raw) ? raw : DEFAULT_TERMINAL_PALETTE
  } catch {
    return DEFAULT_TERMINAL_PALETTE
  }
}

export function writeTerminalPalette(id: TerminalPaletteId): void {
  try {
    localStorage.setItem(TERMINAL_PALETTE_KEY, id)
  } catch {
    // ignore (private mode / disabled storage)
  }
}

/** Runs in `<head>` before first paint, alongside the chat theme's own script. */
export const TERMINAL_PALETTE_BOOT_SCRIPT = `try{var k=${JSON.stringify(
  TERMINAL_PALETTE_KEY,
)},v=${JSON.stringify(TERMINAL_PALETTE_IDS)},d=${JSON.stringify(
  DEFAULT_TERMINAL_PALETTE,
)},t=localStorage.getItem(k);document.documentElement.dataset.termPalette=v.indexOf(t)>=0?t:d}catch(e){}`
