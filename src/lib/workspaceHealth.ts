/**
 * Physical workspace health — what is actually on disk right now, as opposed
 * to the lifecycle status recorded in the `workspaces` row.
 *
 * A row can say `status='ready'` long after its worktree was removed, its
 * branch was switched by hand, or a previous run left it dirty. Arming an
 * unattended automation against such a workspace produces a run that either
 * dies with spawn ENOENT or inherits another run's half-finished work, and in
 * both cases the failure is reported against the wrong automation.
 *
 * Severity ordering matters: a missing directory must win over "dirty",
 * because a path that is gone cannot be inspected for dirt at all.
 *
 * Pure and Node-free so the server gates, the Enable/Run-now gates and the
 * automation UI all describe a broken workspace with the same words.
 */

export type WorkspaceHealthCode =
  /** Directory exists, is the right worktree, on the right branch, clean. */
  | 'ok'
  /** The recorded path is not on disk. */
  | 'missing'
  /** The path exists but git no longer tracks it as a worktree of the project. */
  | 'not-a-worktree'
  /** HEAD is detached — no branch to compare against, nothing to push to. */
  | 'detached'
  /** HEAD is a different branch than the workspace was configured for. */
  | 'branch-drift'
  /** Uncommitted or untracked files are present from something else. */
  | 'dirty'
  /** Quarantined by a previous bad run or a red baseline check pass. */
  | 'blocked'

export type WorkspaceHealth = {
  code: WorkspaceHealthCode
  /** Absolute path that was inspected. */
  path: string
  /** Branch the workspace row says this checkout is on. */
  configuredBranch: string
  /** Branch HEAD actually points at; '' when unknown, 'HEAD' when detached. */
  actualBranch: string
  /** True when the working tree has uncommitted or untracked changes. */
  dirty: boolean
  /** Recorded quarantine reason, for `blocked`. Empty otherwise. */
  detail: string
}

/**
 * Codes that make the workspace unusable for *any* run, attended or not.
 * Everything else is a contamination signal a human at the keyboard can judge
 * for themselves.
 */
export function isFatalHealth(code: WorkspaceHealthCode): boolean {
  return code === 'missing' || code === 'not-a-worktree'
}

export function isWorkspaceHealthy(health: WorkspaceHealth | null | undefined): boolean {
  return health?.code === 'ok'
}

/** Shared wording for a workspace row whose directory is no longer on disk. */
export function missingWorkspaceDirMessage(path: string): string {
  return `The workspace directory is gone (${path}). Recreate it under Projects before running this automation.`
}

export function workspaceHealthMessage(health: WorkspaceHealth): string {
  switch (health.code) {
    case 'ok':
      return 'Workspace is on its configured branch and clean.'
    case 'missing':
      return missingWorkspaceDirMessage(health.path)
    case 'not-a-worktree':
      return `${health.path} is no longer a git worktree of this project. Recreate the workspace under Projects.`
    case 'detached':
      return `The workspace is on a detached HEAD instead of "${health.configuredBranch}". Check the branch out again before an unattended run.`
    case 'branch-drift':
      return `The workspace is on "${health.actualBranch || 'an unknown branch'}" but this automation is configured for "${health.configuredBranch}". A previous run or a manual checkout switched it.`
    case 'dirty':
      return 'The workspace has uncommitted changes left over from earlier work. An unattended run would inherit them — commit, discard, or restore the workspace first.'
    case 'blocked':
      return health.detail || 'The workspace is quarantined after a failed run.'
  }
}

/**
 * Reason this workspace refuses a run, or `null` when it may proceed.
 * Attended runs only trip the fatal codes: a human pressing Run now can see
 * the dirty tree and decide it is fine. Unattended runs trip everything,
 * because nobody is there to notice contamination in the diff.
 */
export function workspaceHealthBlockedReason(
  health: WorkspaceHealth | null | undefined,
  options: { unattended: boolean },
): string | null {
  if (!health || health.code === 'ok') return null
  if (!options.unattended && !isFatalHealth(health.code)) return null
  return workspaceHealthMessage(health)
}
