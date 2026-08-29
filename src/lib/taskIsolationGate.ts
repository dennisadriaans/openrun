/** Shared UI/server copy for workspace-changing automation actions. */

export type TaskActivityInput = {
  activeRunId?: string | null
  queuedCount?: number
}

/**
 * Explain why isolation, restore or quarantine changes must wait. A queued
 * fire is just as important as a running row: moving the workspace underneath
 * it would make the eventual run use a different destination than it showed.
 */
export function taskWorkspaceChangeBlockedReason(input: TaskActivityInput): string | null {
  if (input.activeRunId) {
    return 'Cannot change this workspace while a run is in progress. Stop the run first.'
  }
  if ((input.queuedCount ?? 0) > 0) {
    return 'Cannot change this workspace while a run is queued. Let it drain or remove it first.'
  }
  return null
}
