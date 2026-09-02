/**
 * What an unattended run does with the changes it leaves behind.
 *
 * An app-managed worktree refuses the *next* unattended fire while it is dirty
 * (`workspaceHealth.ts` — an uncommitted tree is indistinguishable from one
 * run's leftovers becoming the next run's starting point). Nothing used to
 * clear that, so a recurring automation that writes files ran once and then
 * refused every later fire with "the workspace has uncommitted changes" until
 * somebody restored it by hand.
 *
 * Committing is the resolution rather than restoring: the work is kept, the
 * commit lands on the worktree's own throwaway branch, and it stays reversible
 * through the machinery that already exists (`git.runCommits` /
 * `git.resetRunCommits`, surfaced as Undo). Restoring would delete the very
 * output the automation was scheduled to produce.
 *
 * The `main` checkout is never committed to. That is the user's own working
 * copy, shared with their editor; an automation that opted out of isolation
 * gets the old behaviour — dirty tree, quarantine, human decides.
 *
 * Pure and browser-safe so the executor and the automation UI describe the
 * same rule in the same words.
 */
import type { RunVerdict } from './verdict.ts'

export type UnattendedCommitInput = {
  /** 'main' is the user's own checkout; 'worktree' is app-managed. */
  workspaceKind: string
  /** True when the run left uncommitted or untracked files behind. */
  dirty: boolean
  /** Verdict the run settled on. '' means it was cancelled or is unjudged. */
  verdict: RunVerdict
}

/**
 * True when the executor should commit what an unattended turn left behind.
 *
 * Every judged verdict commits, not just the good ones. A `failed-checks` or
 * `crashed` run still quarantines its workspace, so a human is still sent to
 * look — but the partial work is preserved on the branch and reviewable as a
 * diff instead of sitting in a dirty tree that also blocks the schedule.
 */
export function shouldCommitUnattendedChanges(input: UnattendedCommitInput): boolean {
  if (input.workspaceKind !== 'worktree') return false
  if (!input.dirty) return false
  // A cancelled or unjudged run is a human's decision mid-flight, not an
  // automation finishing. Leave the tree exactly as the person left it.
  return input.verdict !== ''
}

/** Subject line for the commit an unattended run leaves behind. */
export function unattendedCommitMessage(input: {
  taskName: string
  verdict: RunVerdict
  runId: string
}): string {
  const name = input.taskName.trim() || 'a scheduled run'
  return `chore(openrun): ${name} (${input.verdict || 'unjudged'})\n\nCommitted automatically by Open Run so the workspace is clean for the next\nscheduled fire. Undo it from run ${input.runId}.`
}

/** Note appended to the run's stderr when the automatic commit could not run. */
export function unattendedCommitFailedMessage(detail: string): string {
  return `[executor] could not commit this run's changes: ${detail}. The workspace is left dirty, so the next unattended fire will refuse it until you commit, discard, or restore it.`
}
