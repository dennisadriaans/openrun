/**
 * Shared default-workspace selection for Planner / TaskForm and any surface
 * that pins a run to a project worktree. Pure + dependency-free so browser
 * forms and tests can share it.
 *
 * Only **ready** workspaces are eligible — never auto-pick creating / error /
 * archived rows that save / enable / run would refuse.
 */

import { isWorkspaceReady } from './workspaceReady.ts'

export type WorkspacePickCandidate = {
  id: string
  /** Lifecycle status; only `ready` is eligible. */
  status: string
  /** Prefer the project's main checkout when it is ready. */
  kind?: string | null
}

/**
 * Prefer a ready `main` worktree, else the first ready row. Returns undefined
 * when the list is empty or nothing is ready yet (e.g. still creating).
 */
export function pickDefaultWorkspace<T extends WorkspacePickCandidate>(
  workspaces: readonly T[],
): T | undefined {
  const ready = workspaces.filter((w) => isWorkspaceReady(w.status))
  if (ready.length === 0) return undefined
  return ready.find((w) => w.kind === 'main') ?? ready[0]
}

/** Convenience: just the id, or undefined when there is nothing ready to pick. */
export function pickDefaultWorkspaceId(
  workspaces: readonly WorkspacePickCandidate[],
): string | undefined {
  return pickDefaultWorkspace(workspaces)?.id
}
