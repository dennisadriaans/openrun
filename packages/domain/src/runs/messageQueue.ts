/**
 * Follow-up message queue policy.
 *
 * A run holds one agent turn at a time, so a follow-up typed while the agent
 * is still working used to be refused ("wait for it to finish"). Every CLI we
 * drive solves this the same way — Claude Code, Codex and Grok all let you keep
 * typing and deliver each message as its own turn once the current one ends —
 * so Open Run parks them instead of refusing, and hands them to the runtime in
 * order.
 *
 * Two ways out of the queue: it drains itself when the turn finishes, or the
 * user forces delivery, which interrupts the agent and starts the queue now.
 *
 * Node-free so the server, the chat cache and the composer share one set of
 * rules.
 */

/** How many follow-ups one run may hold before the composer refuses more. */
export const MAX_QUEUED_MESSAGES = 10

/** A follow-up waiting on the current turn. */
export type QueuedMessage = {
  id: string
  runId: string
  prompt: string
  model: string
  effort: string
  runtimeMode: string
  /** Set only when the queued turn also hands the chat to another runtime. */
  runtimeId: string
  queuedAt: number
}

export type QueueMessageDecision = { action: 'enqueue' } | { action: 'drop'; reason: string }

export function queueMessageDecision(depth: number): QueueMessageDecision {
  if (depth >= MAX_QUEUED_MESSAGES) {
    return {
      action: 'drop',
      reason: `Already ${MAX_QUEUED_MESSAGES} messages waiting — let the agent catch up first.`,
    }
  }
  return { action: 'enqueue' }
}

export function queuedMessagesLabel(depth: number): string {
  if (depth <= 0) return ''
  return depth === 1 ? '1 message queued' : `${depth} messages queued`
}

/**
 * What the queue strip says about itself. `running` is the run's own status:
 * a queue outlives a cancelled turn rather than being thrown away, and then it
 * waits for the user rather than for the agent.
 */
export function queueStatusNote(input: { depth: number; running: boolean }): string {
  if (input.depth <= 0) return ''
  return input.running
    ? 'Sends when this turn finishes'
    : 'Paused — the turn was stopped before these were sent'
}
