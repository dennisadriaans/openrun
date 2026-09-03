/**
 * Rules for switching a run's runtime mid-conversation (Claude ⇄ Codex ⇄ …).
 *
 * The switch is a handoff, not a resume: the new CLI gets a fresh session and
 * the previous conversation only as the summary `handoffPrompt.ts` builds. Both
 * the composer and the server's follow-up path call these, so what the UI
 * offers is what the server accepts.
 */
import { defaultEffort, defaultModel, findModel, type ModelOption } from './models.ts'
import { supportsSupervised } from './supervisedPolicy.ts'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from './runtimeMode.ts'

/** Shown once before the first switch, behind a "don't show again" checkbox. */
export const RUNTIME_SWITCH_NOTE_TITLE = 'Switching runtime starts a new session'
export const RUNTIME_SWITCH_NOTE_POINTS = [
  'The new agent gets a summary of this chat, not the original session — details outside the summary are lost.',
  'Files, branch, and diffs stay exactly as they are.',
  'Model and reasoning reset to the new runtime’s own options.',
] as const

export function isRuntimeSwitch(
  currentId: string | null | undefined,
  nextId: string | null | undefined,
): boolean {
  const from = currentId?.trim() ?? ''
  const to = nextId?.trim() ?? ''
  return from.length > 0 && to.length > 0 && from !== to
}

/**
 * Why this run cannot switch right now, or null when it can. A missing target
 * is not an error here — the picker simply has nothing selected yet.
 */
export function runtimeSwitchBlockedReason(input: {
  running: boolean
  next?: { label: string; installed?: boolean } | null
}): string | null {
  if (input.running) return 'The agent is still working — wait for this turn to finish.'
  if (!input.next) return null
  if (input.next.installed === false) {
    return `${input.next.label} is not on PATH, so it cannot take over this chat.`
  }
  return null
}

/**
 * Model + effort for the runtime being switched to. A slug from the old
 * runtime is meaningless to the new one, so it is only kept when the new
 * catalog actually has it.
 */
export function resolveSwitchModel(
  models: readonly ModelOption[],
  preferred: string | null | undefined,
): { model: string; effort: string } {
  const list = [...models]
  const match = findModel(list, preferred ?? '')
  const picked = match ?? defaultModel(list)
  return { model: picked?.slug ?? '', effort: defaultEffort(picked) }
}

/** Supervised only survives a switch to a runtime that can ask for permission. */
export function resolveSwitchMode(
  mode: RuntimeMode | string | null | undefined,
  runtime: { bin: string | null | undefined; transport?: string | null },
): RuntimeMode {
  const parsed = parseRuntimeMode(mode)
  if (parsed !== 'approval-required') return parsed
  return supportsSupervised(runtime) ? parsed : DEFAULT_RUNTIME_MODE
}
