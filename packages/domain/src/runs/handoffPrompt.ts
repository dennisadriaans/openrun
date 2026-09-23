/**
 * Handoff preamble for a mid-conversation runtime switch.
 *
 * Agent sessions are per-CLI and opaque — Codex cannot load Claude's session
 * id. Continuing a run on another runtime therefore means starting a *new*
 * session and telling it, in the prompt, what the previous one did. This
 * module builds that text.
 *
 * Pure and browser-safe so the composer can preview the same string the server
 * sends.
 */

export type HandoffMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Whole preamble budget; the transcript is trimmed from the oldest end. */
const DEFAULT_MAX_CHARS = 12_000
const PER_MESSAGE_CHARS = 1_500
const MAX_FILES = 40

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\n{3,}/g, '\n\n')
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`
}

function speaker(role: HandoffMessage['role']): string {
  return role === 'user' ? 'User' : role === 'assistant' ? 'Previous agent' : 'Note'
}

/** One-line transcript marker written as a system message on the switch turn. */
export function handoffSystemNote(fromLabel: string, toLabel: string): string {
  return `Switched from ${fromLabel} to ${toLabel} — new agent session, context carried over as a summary.`
}

/**
 * Prefix `prompt` with what the new runtime needs to pick the conversation up.
 * Returns `prompt` unchanged when there is nothing to hand over.
 */
export function buildHandoffPrompt(input: {
  fromLabel: string
  toLabel: string
  messages: readonly HandoffMessage[]
  /** Paths changed so far in the run's workspace. */
  files?: readonly string[]
  prompt: string
  maxChars?: number
}): string {
  const turns = input.messages
    .filter((m) => m.role !== 'system' && m.content.trim().length > 0)
    .map((m) => `${speaker(m.role)}: ${clip(m.content, PER_MESSAGE_CHARS)}`)
  const files = (input.files ?? []).filter((p) => p.trim().length > 0)

  if (turns.length === 0 && files.length === 0) return input.prompt

  const budget = input.maxChars ?? DEFAULT_MAX_CHARS
  const kept: string[] = []
  let used = 0
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const entry = turns[i]!
    if (used + entry.length > budget && kept.length > 0) break
    kept.unshift(entry)
    used += entry.length
  }
  const dropped = turns.length - kept.length

  const lines = [
    `You are taking over a conversation that was running on ${input.fromLabel}. That session cannot be resumed here, so the work so far is summarised below. Continue it — do not start over.`,
    '',
    '<handoff-transcript>',
    ...(dropped > 0 ? [`(${dropped} earlier turn${dropped === 1 ? '' : 's'} omitted)`, ''] : []),
    kept.join('\n\n'),
    '</handoff-transcript>',
  ]

  if (files.length > 0) {
    const shown = files.slice(0, MAX_FILES)
    const more = files.length - shown.length
    lines.push(
      '',
      '<handoff-changed-files>',
      ...shown,
      ...(more > 0 ? [`(+${more} more)`] : []),
      '</handoff-changed-files>',
      '',
      'Those files are already modified in the working tree. Read them before editing.',
    )
  }

  lines.push('', 'The user now asks:', '', input.prompt)
  return lines.join('\n')
}
