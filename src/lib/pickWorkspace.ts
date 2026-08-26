/**
 * Shared default-workspace selection for Planner / TaskForm and any surface
 * that pins a run to a project worktree. Pure + dependency-free so browser
 * forms and tests can share it.
 *
 * Only **ready** workspaces are eligible — never auto-pick creating / error /
 * archived rows that save / enable / run would refuse.
 *
 * The default preference is a **worktree**, not the project's `main` checkout:
 * these surfaces arm unattended work, and an automation that fires on a cron
 * or a webhook writing into the checkout the user has open in their editor is
 * the one outcome nobody asks for. `main` stays a fallback so a project that
 * has no worktree yet still gets a usable selection instead of an empty form —
 * `WorkspacePicker` says so when that is what got picked.
 */

import { isWorkspaceReady } from './workspaceReady.ts'

export type WorkspacePickCandidate = {
  id: string
  /** Lifecycle status; only `ready` is eligible. */
  status: string
  /** `main` is the checkout shared with the user's editor; anything else is a worktree. */
  kind?: string | null
}

export type WorkspacePickOptions = {
  /** Which kind to reach for first. Defaults to `worktree`. */
  prefer?: 'main' | 'worktree'
}

/**
 * Prefer a ready row of the preferred kind, else the first ready row. Returns
 * undefined when the list is empty or nothing is ready yet (e.g. still creating).
 */
export function pickDefaultWorkspace<T extends WorkspacePickCandidate>(
  workspaces: readonly T[],
  options: WorkspacePickOptions = {},
): T | undefined {
  const ready = workspaces.filter((w) => isWorkspaceReady(w.status))
  if (ready.length === 0) return undefined
  const wantMain = options.prefer === 'main'
  return ready.find((w) => (w.kind === 'main') === wantMain) ?? ready[0]
}

/** Convenience: just the id, or undefined when there is nothing ready to pick. */
export function pickDefaultWorkspaceId(
  workspaces: readonly WorkspacePickCandidate[],
  options: WorkspacePickOptions = {},
): string | undefined {
  return pickDefaultWorkspace(workspaces, options)?.id
}

/**
 * Whether a chosen workspace is the checkout shared with the user's editor.
 * Drives the warning on automation forms, which is the only thing standing
 * between a cron trigger and the user's open files.
 */
export function isMainCheckout(workspace: WorkspacePickCandidate | undefined): boolean {
  return workspace?.kind === 'main'
}
