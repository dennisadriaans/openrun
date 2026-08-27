/**
 * Chat transcript themes.
 *
 * A theme is two things: a block of CSS custom properties in `styles.css`
 * (`[data-chat-theme='…']`) that repaints and reshapes every transcript row,
 * and the handful of behaviours CSS cannot express — what starts expanded.
 * Components read {@link chatThemeBehaviour}; everything else is CSS.
 *
 * Browser-safe and dependency-free (`lib/` rule) so the boot script below and
 * the React provider agree on the same key and the same set of valid ids.
 */
import type { ToolKind } from './acp.ts'

/** `terminal` is what the debug toggle in the run top bar turns on. */
export type ChatThemeId = 'openrun' | 'terminal'

export const CHAT_THEME_IDS: readonly ChatThemeId[] = ['openrun', 'terminal']

export const DEFAULT_CHAT_THEME: ChatThemeId = 'openrun'

export function isChatThemeId(value: unknown): value is ChatThemeId {
  return typeof value === 'string' && (CHAT_THEME_IDS as readonly string[]).includes(value)
}

/**
 * The parts of a theme that are not paint.
 *
 * `expandToolKinds` mirrors what a CLI prints inline: a shell command shows
 * its output under the row, a file read does not — it would bury the answer.
 */
export type ChatThemeBehaviour = {
  /** Tool kinds whose body opens without a click. */
  expandToolKinds: readonly ToolKind[]
  /** Draw a settled turn's work inline instead of behind "Worked for 15s". */
  unfoldTurns: boolean
}

const BEHAVIOUR: Record<ChatThemeId, ChatThemeBehaviour> = {
  openrun: { expandToolKinds: [], unfoldTurns: false },
  terminal: { expandToolKinds: ['execute'], unfoldTurns: true },
}

export function chatThemeBehaviour(id: ChatThemeId): ChatThemeBehaviour {
  return BEHAVIOUR[id] ?? BEHAVIOUR[DEFAULT_CHAT_THEME]
}

export const CHAT_THEME_KEY = 'agentops:chatTheme'

export function readChatTheme(): ChatThemeId {
  try {
    const raw = localStorage.getItem(CHAT_THEME_KEY)
    return isChatThemeId(raw) ? raw : DEFAULT_CHAT_THEME
  } catch {
    return DEFAULT_CHAT_THEME
  }
}

export function writeChatTheme(id: ChatThemeId): void {
  try {
    localStorage.setItem(CHAT_THEME_KEY, id)
  } catch {
    // ignore (private mode / disabled storage)
  }
}

/**
 * Runs in `<head>` before first paint so a terminal-themed transcript never
 * flashes as bubbles. React syncs the same value into state after hydration.
 */
export const CHAT_THEME_BOOT_SCRIPT = `try{var k=${JSON.stringify(CHAT_THEME_KEY)},v=${JSON.stringify(
  CHAT_THEME_IDS,
)},t=localStorage.getItem(k);if(v.indexOf(t)>=0)document.documentElement.dataset.chatTheme=t}catch(e){}`
