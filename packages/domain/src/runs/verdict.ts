/**
 * Run verdicts — what actually came out of a run, as opposed to whether the
 * process exited 0.
 *
 * `status` answers "did the CLI exit cleanly". That is a poor proxy for "did
 * the work land": an agent exits 0 after writing code that does not compile,
 * and exits 0 after doing nothing at all. The verdict folds in the post-run
 * checks and the size of the diff so an unattended run can be trusted — or
 * flagged — without a human reading the transcript.
 *
 * Pure and Node-free so the executor, the dashboard, the run list and the
 * notifier all label a run the same way.
 */

export type RunVerdict =
  /** Not evaluated yet — still queued/running, cancelled, or a legacy row. */
  | ''
  /** Checks ran and passed, and the run changed something. */
  | 'verified'
  /** The turn exited cleanly but a check failed. */
  | 'failed-checks'
  /** Clean exit, checks green, but the worktree is byte-identical to the base. */
  | 'no-changes'
  /** Clean exit and changes, but no checks were configured to judge them. */
  | 'unverified'
  /** Killed because it exceeded the run's wall-clock budget. */
  | 'timeout'
  /** The agent process itself failed (non-zero exit, spawn error, gh failure). */
  | 'crashed'

export type CheckOutcome = 'passed' | 'failed' | 'timeout' | 'skipped'

/** The slice of a check result the verdict actually depends on. */
export type CheckResultLike = {
  outcome: CheckOutcome
}

export type DeriveVerdictInput = {
  /** Terminal run status from the executor. */
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled' | string
  /** True when the run was killed by its own wall-clock budget. */
  timedOut?: boolean
  /** Results of the checks that ran after the final turn. */
  checks: CheckResultLike[]
  /** Number of files changed versus the run's base snapshot. */
  changedFiles: number
}

export function checkFailed(result: CheckResultLike): boolean {
  return result.outcome === 'failed' || result.outcome === 'timeout'
}

export function failedChecks(checks: CheckResultLike[]): CheckResultLike[] {
  return checks.filter(checkFailed)
}

/**
 * Single source of truth for a run's verdict. Ordered most-severe first so a
 * crashed run is never reported as "no changes" just because it died before
 * writing anything.
 */
export function deriveVerdict(input: DeriveVerdictInput): RunVerdict {
  if (input.status === 'running' || input.status === 'queued') return ''
  // A cancelled run was a human decision — there is nothing to judge.
  if (input.status === 'cancelled') return ''
  if (input.timedOut) return 'timeout'
  if (input.status !== 'success') return 'crashed'
  if (failedChecks(input.checks).length > 0) return 'failed-checks'
  if (input.changedFiles === 0) return 'no-changes'
  if (input.checks.some((c) => c.outcome === 'passed')) return 'verified'
  return 'unverified'
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export type VerdictTone = 'success' | 'danger' | 'warning' | 'neutral'

const VERDICT_META: Record<
  Exclude<RunVerdict, ''>,
  { label: string; tone: VerdictTone; description: string }
> = {
  verified: {
    label: 'Verified',
    tone: 'success',
    description: 'Changes landed and every check passed.',
  },
  'failed-checks': {
    label: 'Checks failed',
    tone: 'danger',
    description: 'The agent finished, but a check is still red.',
  },
  'no-changes': {
    label: 'No changes',
    tone: 'warning',
    description: 'The run exited cleanly without modifying any file.',
  },
  unverified: {
    label: 'Unverified',
    tone: 'neutral',
    description: 'Changes landed, but nothing ran to judge them.',
  },
  timeout: {
    label: 'Timed out',
    tone: 'danger',
    description: 'The run exceeded its time budget and was stopped.',
  },
  crashed: {
    label: 'Crashed',
    tone: 'danger',
    description: 'The agent process itself failed.',
  },
}

export function verdictLabel(verdict: RunVerdict): string {
  return verdict ? VERDICT_META[verdict].label : ''
}

export function verdictTone(verdict: RunVerdict): VerdictTone {
  return verdict ? VERDICT_META[verdict].tone : 'neutral'
}

export function verdictDescription(verdict: RunVerdict): string {
  return verdict ? VERDICT_META[verdict].description : ''
}

/** Verdicts a human should look at. Drives notification defaults and filters. */
export function verdictNeedsAttention(verdict: RunVerdict): boolean {
  return verdict === 'failed-checks' || verdict === 'timeout' || verdict === 'crashed'
}

export function isVerdict(value: unknown): value is RunVerdict {
  return value === '' || (typeof value === 'string' && value in VERDICT_META)
}

export function parseVerdict(value: unknown): RunVerdict {
  return isVerdict(value) ? value : ''
}

/** Every non-empty verdict, in the order the UI should list them. */
export const ALL_VERDICTS: Array<Exclude<RunVerdict, ''>> = [
  'verified',
  'unverified',
  'no-changes',
  'failed-checks',
  'timeout',
  'crashed',
]

// ---------------------------------------------------------------------------
// Auto-repair
// ---------------------------------------------------------------------------

/**
 * Hard cap regardless of what a task asks for. Each attempt is a full agent
 * turn against the same worktree; past a couple of rounds an agent that cannot
 * fix its own test failure is not going to, and it is burning the workspace
 * lock while it tries.
 */
export const MAX_REPAIR_ATTEMPTS = 3

export function clampRepairAttempts(requested: number | null | undefined): number {
  if (!Number.isFinite(requested ?? NaN)) return 0
  const n = Math.floor(requested as number)
  if (n <= 0) return 0
  return Math.min(n, MAX_REPAIR_ATTEMPTS)
}

/**
 * Repair only makes sense for a clean exit with red checks. A crash, a timeout
 * or an empty diff is not something a "the tests are failing, fix them"
 * follow-up can address, and retrying it just doubles the wasted time.
 */
export function shouldAttemptRepair(input: {
  verdict: RunVerdict
  attemptsUsed: number
  maxAttempts: number
  /** Repair resumes the agent session — impossible on runtimes without resume. */
  canFollowUp: boolean
}): boolean {
  if (input.verdict !== 'failed-checks') return false
  if (!input.canFollowUp) return false
  return input.attemptsUsed < clampRepairAttempts(input.maxAttempts)
}

export type FailedCheckSummary = {
  name: string
  command: string
  outcome: CheckOutcome
  exitCode: number | null
  output: string
}

/**
 * The follow-up prompt handed back to the agent on a failed-checks run. Kept
 * pure (and tested) because it is the entire content of an unattended turn —
 * if it is vague the repair loop just burns a second run.
 */
export function buildRepairPrompt(failures: FailedCheckSummary[], attempt: number): string {
  return checkFailurePrompt(
    failures,
    `The verification checks for this workspace are failing after your last turn (repair attempt ${attempt} of ${MAX_REPAIR_ATTEMPTS}).`,
  )
}

/**
 * The same brief, sent because the user pressed "Fix checks" rather than
 * because the repair loop fired. It carries the recorded output so the agent
 * fixes *these* failures instead of re-deriving them from its own guess at
 * which command to run.
 */
export function buildFixChecksPrompt(failures: FailedCheckSummary[]): string {
  return checkFailurePrompt(
    failures,
    'These verification checks are failing in this workspace (output recorded by Open Run, not by you):',
  )
}

function checkFailurePrompt(failures: FailedCheckSummary[], intro: string): string {
  const lines = [
    intro,
    '',
    'Fix the underlying problem in the code. Do not disable, skip, or weaken the check itself, and do not edit the check command.',
    'If a failure is pre-existing and unrelated to your change, say so explicitly instead of working around it.',
    '',
  ]
  for (const failure of failures) {
    lines.push(`--- ${failure.name} (${failure.command})`)
    lines.push(
      failure.outcome === 'timeout'
        ? 'Outcome: timed out'
        : `Outcome: failed with exit code ${failure.exitCode ?? 'unknown'}`,
    )
    const output = failure.output.trim()
    if (output) {
      lines.push('Output:')
      lines.push(output)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
