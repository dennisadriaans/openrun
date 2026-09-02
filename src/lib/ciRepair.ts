/**
 * Turning a red pull request check back into a turn.
 *
 * Open Run already closes the loop *locally*: a project's checks run after an
 * unattended turn, and a failure is handed straight back to the agent as a
 * repair turn (`verdict.ts`). The remote half was open — the pull request's own
 * CI was probed, rolled up into one word, and used to paint a red dot. Nothing
 * consumed it. A run could ship a PR, watch CI go red, and stop there.
 *
 * This is the same loop with a different source of truth. It is deliberately
 * *user-initiated* rather than automatic: an unattended run that re-triggers
 * itself on every CI change is a surprise, and CI failures are frequently not
 * the PR's fault. The button is the honest version.
 *
 * Pure and browser-safe: the transcript builds the prompt, exactly as the local
 * "Fix checks" button does.
 */
import type { FailingCheck, PullRequestState } from './pullRequest.ts'

/**
 * Why "Fix CI" cannot be offered right now, or `null` when it can.
 *
 * A gate module in the sense the rest of the app uses the word: the UI disables
 * the control and explains on hover, rather than failing after the click.
 */
export function ciRepairRefusal(input: {
  state: PullRequestState
  checks: string
  failingChecks: FailingCheck[]
  /** True while the agent is mid-turn. */
  busy: boolean
}): string | null {
  if (input.state === 'merged') return 'This pull request is already merged.'
  if (input.state === 'closed') return 'This pull request is closed.'
  if (input.checks === 'pending') {
    return 'The checks on this pull request are still running. Wait for them to settle.'
  }
  if (input.checks !== 'failing' || input.failingChecks.length === 0) {
    return 'No check on this pull request is failing.'
  }
  if (input.busy) return 'The agent is still working on this run.'
  return null
}

export function canRepairCi(input: Parameters<typeof ciRepairRefusal>[0]): boolean {
  return ciRepairRefusal(input) === null
}

/**
 * The brief handed to the agent.
 *
 * Names the failing checks and points at `gh` for the logs rather than pasting
 * them: CI output is frequently megabytes, the agent has an authenticated `gh`
 * in its environment already, and reading the log itself is more reliable than
 * reading our summary of it. The prohibitions mirror `buildFixChecksPrompt` —
 * an agent told only "make CI green" will delete the test.
 */
export function buildCiRepairPrompt(input: {
  prNumber: number
  prUrl: string
  failingChecks: FailingCheck[]
}): string {
  const lines = [
    `Continuous integration is failing on pull request #${input.prNumber} (${input.prUrl}), which was opened from this run.`,
    '',
    'Failing checks:',
  ]
  for (const check of input.failingChecks) {
    lines.push(check.url ? `- ${check.name} — ${check.url}` : `- ${check.name}`)
  }
  lines.push(
    '',
    `Read the logs yourself before changing anything — \`gh pr checks ${input.prNumber}\` lists them, and \`gh run view <run-id> --log-failed\` prints the failing step. The \`gh\` login is already available in your environment.`,
    '',
    'Then fix the underlying problem in the code and push the fix to this branch.',
    'Do not disable, skip, or weaken a check to make it pass, and do not edit the CI configuration to route around the failure.',
    'If the failure is pre-existing, environmental, or otherwise not caused by this branch, say so explicitly and stop rather than working around it.',
  )
  return lines.join('\n')
}

/** Short label for the button, so the count is visible before the click. */
export function ciRepairLabel(failingChecks: FailingCheck[]): string {
  if (failingChecks.length === 1) return 'Fix failing check'
  return `Fix ${failingChecks.length} failing checks`
}
