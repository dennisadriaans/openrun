/**
 * Workspace-id helpers shared by TaskForm / Planner (browser) and the task
 * write + run paths (server). Kept dependency-free so the client never pulls
 * in SQLite / worktree resolution — those still live in resolveWorkspacePath.
 */

/** Trim; empty means "no workspace selected". */
export function normalizeWorkspaceId(workspaceId: string | null | undefined): string {
  return (workspaceId ?? '').trim()
}

/** Whether an automation has a workspace id to resolve. */
export function hasWorkspaceId(workspaceId: string | null | undefined): boolean {
  return normalizeWorkspaceId(workspaceId).length > 0
}

/** Developer-facing error when an automation is missing a workspace. */
export function missingWorkspaceMessage(): string {
  return 'Pick a repository (workspace) before saving or running this automation. Without one, the agent would fall back to the Open Run app directory.'
}

/** Throw when no workspace id is present. */
export function assertWorkspaceId(workspaceId: string | null | undefined): string {
  const id = normalizeWorkspaceId(workspaceId)
  if (!id) throw new Error(missingWorkspaceMessage())
  return id
}
