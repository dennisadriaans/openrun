/** Browser-safe placement policy shared by executor and unattended gates. */

export type AutomationTrigger = 'manual' | 'schedule' | 'webhook'

/** Webhook deliveries alone get a clean, Open Run-owned execution worktree. */
export function usesFreshExecution(trigger: string): boolean {
  return trigger === 'webhook'
}

/** A saved native conversation belongs to its existing workspace. */
export function resumesSavedSession(trigger: AutomationTrigger): boolean {
  return !usesFreshExecution(trigger)
}
