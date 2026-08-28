/**
 * What "Undo All" is allowed to take back.
 *
 * Restoring files is always safe: the run's base snapshot holds every byte as
 * it stood when the run started, dirt included. Commits are the part that
 * needs a decision — a run that committed leaves those commits on the branch
 * after a file-level undo, so the tree reads as "put back" while `git log`
 * still shows the agent's work. Moving the branch pointer back is what closes
 * that gap, and it is a history rewrite, so it stays opt-in and refuses once
 * the commits exist anywhere but this machine.
 *
 * Browser-safe like the rest of `lib/`: the modal's checkbox and the server's
 * pre-reset assertion read the same rule, so the reason shown on hover is the
 * one the write path would have thrown.
 */

export type RunCommit = {
  /** Full SHA — the short form is for display only. */
  sha: string
  subject: string
}

export type RunCommitSummary = {
  /**
   * Commit the branch pointed at when the run started, resolved from the base
   * snapshot. Empty when there is nothing safe to reset to — no snapshot, or a
   * history that has moved since (a rebase) and no longer contains it.
   */
  baseCommit: string
  /** Commits made between the run's start and HEAD, newest first. */
  commits: RunCommit[]
  /** How many of those already exist on a remote-tracking branch. */
  published: number
}

export const NO_RUN_COMMITS: RunCommitSummary = { baseCommit: '', commits: [], published: 0 }

/**
 * Why the commits cannot be dropped, or `null` when they can.
 * Never a reason to block the file-level undo — that path stands on its own.
 */
export function undoCommitsBlockedReason(summary: RunCommitSummary): string | null {
  if (summary.commits.length === 0) return 'This run made no commits.'
  if (summary.published > 0) {
    return summary.published === summary.commits.length
      ? 'These commits are already on a remote. Dropping them would rewrite published history — revert them instead.'
      : `${summary.published} of these commits are already on a remote. Dropping them would rewrite published history — revert them instead.`
  }
  if (!summary.baseCommit) {
    return 'The branch has moved since this run started, so there is no commit to reset back to.'
  }
  return null
}

export function canUndoRunCommits(summary: RunCommitSummary): boolean {
  return undoCommitsBlockedReason(summary) === null
}

/** Checkbox label — the count is the whole point, so it leads. */
export function undoCommitsLabel(summary: RunCommitSummary): string {
  const n = summary.commits.length
  return n === 1 ? 'Also drop the commit this run made' : `Also drop the ${n} commits this run made`
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}
