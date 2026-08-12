/**
 * Workspace lifecycle readiness helpers shared by TaskForm / Planner / list UI
 * (browser) and the task write + run paths (server). Kept dependency-free so
 * the client never pulls in SQLite / worktree resolution.
 */

/** Statuses a workspace can be in while still selectable in some UIs. */
export type WorkspaceLifecycleStatus = 'creating' | 'ready' | 'error' | 'archived'

/** Whether a workspace status is safe to save / enable / run against. */
export function isWorkspaceReady(status: string | null | undefined): boolean {
  return status === 'ready'
}

/**
 * Developer-facing error when a workspace exists but is not ready for agent
 * work. `null` / empty means the id no longer resolves to a row.
 */
export function workspaceNotReadyMessage(status: string | null | undefined): string {
  if (status == null || status === '') {
    return 'Workspace not found — pick another repository worktree under Projects.'
  }
  switch (status) {
    case 'creating':
      return 'This workspace is still being set up — wait until it shows as ready under Projects before saving or running an automation.'
    case 'error':
      return 'This workspace failed setup — fix or recreate it under Projects before saving or running an automation.'
    case 'archived':
      return 'Workspace is archived'
    case 'ready':
      return 'Workspace is ready'
    default:
      return `Workspace is not ready (status: ${status})`
  }
}

/** Throw when status is anything other than ready. */
export function assertWorkspaceReady(status: string | null | undefined): void {
  if (isWorkspaceReady(status)) return
  throw new Error(workspaceNotReadyMessage(status))
}
