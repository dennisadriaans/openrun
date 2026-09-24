/**
 * The unattended path from a verified run to a pull request that is ready to
 * merge.
 *
 * A scheduled or webhook run works in its own execution checkout
 * (`executionWorkspace.ts`), and the project's checks judge it before anything
 * leaves the machine (`verdict.ts`). Only a `verified` run is shipped, and the
 * executor ships it — not the agent — so every automation lands the same way:
 * conventional commits, a `<type>/<slug>` branch, one pull request.
 *
 * After that the pull request is watched. A red check or a merge conflict is
 * handed back to the same conversation as a repair turn, bounded by the
 * automation's repair attempts, until GitHub reports it green and mergeable.
 * Merging stays a human decision.
 *
 * Pure and browser-safe so the executor, the watcher and their tests read the
 * same rules.
 */
import type {
  FailingCheck,
  PullRequestChecks,
  PullRequestState,
} from '../workspaces/pullRequest.ts'
import type { RunVerdict } from './verdict.ts'

/** True when the executor should ship this finished turn as a pull request. */
export function shouldAutoShip(input: {
  trigger: string
  /** The run has its own execution checkout. */
  freshExecution: boolean
  verdict: RunVerdict
  /** The runtime may push and open pull requests in this access mode. */
  canOpenPrs: boolean
}): boolean {
  if (input.trigger !== 'schedule' && input.trigger !== 'webhook') return false
  return input.freshExecution && input.canOpenPrs && input.verdict === 'verified'
}

/** GitHub's `mergeable` field, lower-cased; `unknown` while it is computing. */
export type PrMergeable = 'mergeable' | 'conflicting' | 'unknown'

export function parseMergeable(raw: unknown): PrMergeable {
  const value = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (value === 'MERGEABLE') return 'mergeable'
  if (value === 'CONFLICTING') return 'conflicting'
  return 'unknown'
}

/** How long a watched pull request may sit without progress before we stop. */
export const PR_WATCH_IDLE_LIMIT_MS = 3 * 60 * 60_000

/**
 * How long "no checks" is read as "checks have not registered yet". GitHub
 * attaches a push's workflow runs a few seconds to a minute after the push;
 * a repository without CI stays at `none` for good.
 */
export const PR_NO_CHECKS_GRACE_MS = 2 * 60_000

export type PrWatchInput = {
  state: PullRequestState
  checks: PullRequestChecks
  failingChecks: FailingCheck[]
  mergeable: PrMergeable
  /** The pull request's current head commit. */
  headSha: string
  /** Head commit the last repair turn was handed; '' before the first. */
  repairedSha: string
  attemptsUsed: number
  maxAttempts: number
  /** The agent is mid-turn on this run. */
  busy: boolean
  /** Time since the watch last pushed, repaired or opened the pull request. */
  sinceActivityMs: number
}

export type PrWatchDecision =
  | { kind: 'wait' }
  | { kind: 'ready' }
  | { kind: 'stop'; reason: string }
  | { kind: 'repair'; cause: 'ci' | 'conflict' }

/**
 * What the watcher does next. Ordered so a closed pull request always ends the
 * watch, a busy agent is never interrupted, and a repair is never repeated for
 * a head commit the agent already had its chance at.
 */
export function prWatchDecision(input: PrWatchInput): PrWatchDecision {
  if (input.state === 'merged') return { kind: 'stop', reason: 'The pull request was merged.' }
  if (input.state === 'closed') return { kind: 'stop', reason: 'The pull request was closed.' }
  if (input.busy) return { kind: 'wait' }
  if (input.sinceActivityMs > PR_WATCH_IDLE_LIMIT_MS) {
    return {
      kind: 'stop',
      reason: 'Stopped watching the pull request after three hours without a settled result.',
    }
  }

  if (input.mergeable === 'conflicting') return repairOrStop(input, 'conflict')
  if (input.checks === 'pending') return { kind: 'wait' }
  if (input.checks === 'failing') return repairOrStop(input, 'ci')
  if (input.mergeable === 'unknown') return { kind: 'wait' }
  if (input.checks === 'none' && input.sinceActivityMs < PR_NO_CHECKS_GRACE_MS) {
    return { kind: 'wait' }
  }
  return { kind: 'ready' }
}

function repairOrStop(input: PrWatchInput, cause: 'ci' | 'conflict'): PrWatchDecision {
  const what = cause === 'ci' ? 'failing checks' : 'merge conflict'
  if (input.repairedSha && input.repairedSha === input.headSha) {
    return {
      kind: 'stop',
      reason: `The last repair turn did not push a fix for the ${what}. Review the run before retrying.`,
    }
  }
  if (input.attemptsUsed >= input.maxAttempts) {
    return {
      kind: 'stop',
      reason:
        input.maxAttempts === 0
          ? `The pull request has a ${what}. This automation has repair attempts turned off.`
          : `The pull request still has a ${what} after ${input.attemptsUsed} repair attempt${input.attemptsUsed === 1 ? '' : 's'}.`,
    }
  }
  return { kind: 'repair', cause }
}

/**
 * The brief for a conflicted pull request. Rebase rather than merge, so the
 * branch stays a clean stack on the base the reviewer sees.
 */
export function buildConflictRepairPrompt(input: {
  prNumber: number
  prUrl: string
  baseBranch: string
}): string {
  const base = input.baseBranch || 'main'
  return [
    `Pull request #${input.prNumber} (${input.prUrl}), which was opened from this run, has merge conflicts with \`${base}\`.`,
    '',
    `Run \`git fetch origin ${base}\` and rebase this branch onto \`origin/${base}\`. Resolve every conflict so the intent of both sides survives, then run the project's tests and linters.`,
    '',
    'Do not drop the other side of a conflict to make it go away.',
    'If a conflict needs a decision from a person, run `git rebase --abort`, say so explicitly, and stop.',
    'Open Run pushes the rebased branch after the checks pass; do not open another pull request.',
  ].join('\n')
}

/** One line for the run transcript when the watch settles. */
export function prReadyMessage(prUrl: string): string {
  return `Pull request ${prUrl} is green and mergeable. Merging is up to you.`
}
