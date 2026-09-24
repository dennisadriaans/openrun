/**
 * Browser-safe placement policy shared by executor and unattended gates.
 *
 * A run nobody is watching starts from a fresh, Open Run-owned checkout of the
 * automation's base, so ten automations on one repository never share a tree
 * and none of them inherits the user's uncommitted edits. A run someone is
 * watching — a chat, `openrun run`, "Run now" — stays in the selected checkout,
 * branch and edits included.
 *
 * The one unattended exception is an automation that resumes a saved CLI chat:
 * the session lives in its original checkout, so it continues there.
 */

export type AutomationTrigger = 'manual' | 'schedule' | 'webhook'

export type PlacementInput = {
  trigger: string
  /** Saved native chat the automation continues; empty for a new conversation. */
  resumeSessionId?: string
}

/** True when this fire gets its own execution worktree instead of the checkout. */
export function usesFreshExecution(input: PlacementInput): boolean {
  if (input.trigger === 'webhook') return true
  if (input.trigger === 'schedule') return !input.resumeSessionId?.trim()
  return false
}

/** A saved native conversation belongs to its existing workspace. */
export function resumesSavedSession(input: PlacementInput): boolean {
  return !usesFreshExecution(input)
}
