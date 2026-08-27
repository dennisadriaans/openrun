/**
 * Reads the persisted chat theme and puts it on `<html data-chat-theme>`, which
 * is the only hook `styles.css` needs. Components that need the non-CSS half of
 * a theme call {@link useChatThemeBehaviour}.
 *
 * State starts at the default and syncs from localStorage in an effect so the
 * server render and the first client render agree; the inline boot script in
 * `__root.tsx` has already set the attribute by then, so nothing flashes.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  CHAT_THEME_KEY,
  DEFAULT_CHAT_THEME,
  chatThemeBehaviour,
  readChatTheme,
  writeChatTheme,
  type ChatThemeBehaviour,
  type ChatThemeId,
} from '../../lib/chatTheme'
import {
  DEFAULT_TERMINAL_PALETTE,
  TERMINAL_PALETTE_KEY,
  readTerminalPalette,
  writeTerminalPalette,
  type TerminalPaletteId,
} from '../../lib/terminalPalette'

type ChatThemeContextValue = {
  theme: ChatThemeId
  setTheme: (id: ChatThemeId) => void
  palette: TerminalPaletteId
  setPalette: (id: TerminalPaletteId) => void
}

const ChatThemeContext = createContext<ChatThemeContextValue | null>(null)

export function ChatThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ChatThemeId>(DEFAULT_CHAT_THEME)
  const [palette, setPaletteState] = useState<TerminalPaletteId>(DEFAULT_TERMINAL_PALETTE)

  useEffect(() => {
    setThemeState(readChatTheme())
    setPaletteState(readTerminalPalette())
  }, [])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHAT_THEME_KEY) setThemeState(readChatTheme())
      if (e.key === TERMINAL_PALETTE_KEY) setPaletteState(readTerminalPalette())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.chatTheme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.termPalette = palette
  }, [palette])

  const setTheme = useCallback((id: ChatThemeId) => {
    writeChatTheme(id)
    setThemeState(id)
  }, [])

  const setPalette = useCallback((id: TerminalPaletteId) => {
    writeTerminalPalette(id)
    setPaletteState(id)
  }, [])

  return (
    <ChatThemeContext.Provider value={{ theme, setTheme, palette, setPalette }}>
      {children}
    </ChatThemeContext.Provider>
  )
}

/** Current theme and palette plus setters. Falls back to defaults outside a provider. */
export function useChatTheme(): ChatThemeContextValue {
  return (
    useContext(ChatThemeContext) ?? {
      theme: DEFAULT_CHAT_THEME,
      setTheme: () => {},
      palette: DEFAULT_TERMINAL_PALETTE,
      setPalette: () => {},
    }
  )
}

/** What the theme changes beyond CSS — what starts expanded. */
export function useChatThemeBehaviour(): ChatThemeBehaviour {
  return chatThemeBehaviour(useChatTheme().theme)
}
