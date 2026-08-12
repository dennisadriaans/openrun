import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALL_VERDICTS,
  MAX_REPAIR_ATTEMPTS,
  buildRepairPrompt,
  clampRepairAttempts,
  deriveVerdict,
  parseVerdict,
  shouldAttemptRepair,
  verdictLabel,
  verdictNeedsAttention,
  verdictTone,
  type CheckResultLike,
} from './verdict.ts'

const passing: CheckResultLike = { outcome: 'passed' }
const failing: CheckResultLike = { outcome: 'failed' }

describe('deriveVerdict', () => {
  it('is empty while the run has not finished', () => {
    assert.equal(deriveVerdict({ status: 'running', checks: [], changedFiles: 3 }), '')
    assert.equal(deriveVerdict({ status: 'queued', checks: [], changedFiles: 0 }), '')
  })

  it('is empty for a cancelled run — a human already decided', () => {
    assert.equal(deriveVerdict({ status: 'cancelled', checks: [failing], changedFiles: 0 }), '')
  })

  it('reports a timeout ahead of everything else', () => {
    assert.equal(
      deriveVerdict({ status: 'error', timedOut: true, checks: [failing], changedFiles: 0 }),
      'timeout',
    )
  })

  it('reports a crash before judging the diff', () => {
    assert.equal(deriveVerdict({ status: 'error', checks: [], changedFiles: 0 }), 'crashed')
    assert.equal(deriveVerdict({ status: 'error', checks: [passing], changedFiles: 5 }), 'crashed')
  })

  it('reports failed checks on a clean exit', () => {
    assert.equal(
      deriveVerdict({ status: 'success', checks: [passing, failing], changedFiles: 4 }),
      'failed-checks',
    )
  })

  it('treats a timed-out check as a failure', () => {
    assert.equal(
      deriveVerdict({ status: 'success', checks: [{ outcome: 'timeout' }], changedFiles: 4 }),
      'failed-checks',
    )
  })

  it('flags a clean run that changed nothing', () => {
    assert.equal(
      deriveVerdict({ status: 'success', checks: [passing], changedFiles: 0 }),
      'no-changes',
    )
    assert.equal(deriveVerdict({ status: 'success', checks: [], changedFiles: 0 }), 'no-changes')
  })

  it('is unverified when changes landed with nothing to judge them', () => {
    assert.equal(deriveVerdict({ status: 'success', checks: [], changedFiles: 2 }), 'unverified')
  })

  it('does not count a skipped check as verification', () => {
    assert.equal(
      deriveVerdict({ status: 'success', checks: [{ outcome: 'skipped' }], changedFiles: 2 }),
      'unverified',
    )
  })

  it('is verified when a check passed and files changed', () => {
    assert.equal(deriveVerdict({ status: 'success', checks: [passing], changedFiles: 1 }), 'verified')
  })
})

describe('verdict presentation', () => {
  it('labels every verdict', () => {
    for (const verdict of ALL_VERDICTS) {
      assert.ok(verdictLabel(verdict).length > 0, verdict)
    }
    assert.equal(verdictLabel(''), '')
  })

  it('flags only actionable verdicts for attention', () => {
    assert.equal(verdictNeedsAttention('failed-checks'), true)
    assert.equal(verdictNeedsAttention('timeout'), true)
    assert.equal(verdictNeedsAttention('crashed'), true)
    assert.equal(verdictNeedsAttention('verified'), false)
    assert.equal(verdictNeedsAttention('no-changes'), false)
    assert.equal(verdictNeedsAttention(''), false)
  })

  it('tones failures danger and success success', () => {
    assert.equal(verdictTone('verified'), 'success')
    assert.equal(verdictTone('crashed'), 'danger')
    assert.equal(verdictTone('no-changes'), 'warning')
  })

  it('parses unknown values back to empty', () => {
    assert.equal(parseVerdict('verified'), 'verified')
    assert.equal(parseVerdict('nonsense'), '')
    assert.equal(parseVerdict(undefined), '')
    assert.equal(parseVerdict(7), '')
  })
})

describe('clampRepairAttempts', () => {
  it('floors at zero and caps at the hard maximum', () => {
    assert.equal(clampRepairAttempts(-2), 0)
    assert.equal(clampRepairAttempts(0), 0)
    assert.equal(clampRepairAttempts(1), 1)
    assert.equal(clampRepairAttempts(99), MAX_REPAIR_ATTEMPTS)
    assert.equal(clampRepairAttempts(null), 0)
    assert.equal(clampRepairAttempts(undefined), 0)
  })
})

describe('shouldAttemptRepair', () => {
  const base = { verdict: 'failed-checks' as const, attemptsUsed: 0, maxAttempts: 1, canFollowUp: true }

  it('repairs a failed-checks run with budget left', () => {
    assert.equal(shouldAttemptRepair(base), true)
  })

  it('never repairs a crash, a timeout or an empty diff', () => {
    assert.equal(shouldAttemptRepair({ ...base, verdict: 'crashed' }), false)
    assert.equal(shouldAttemptRepair({ ...base, verdict: 'timeout' }), false)
    assert.equal(shouldAttemptRepair({ ...base, verdict: 'no-changes' }), false)
    assert.equal(shouldAttemptRepair({ ...base, verdict: 'verified' }), false)
  })

  it('stops once the budget is spent', () => {
    assert.equal(shouldAttemptRepair({ ...base, attemptsUsed: 1, maxAttempts: 1 }), false)
    assert.equal(shouldAttemptRepair({ ...base, attemptsUsed: 1, maxAttempts: 2 }), true)
  })

  it('respects the hard cap even when a task asks for more', () => {
    assert.equal(
      shouldAttemptRepair({ ...base, attemptsUsed: MAX_REPAIR_ATTEMPTS, maxAttempts: 99 }),
      false,
    )
  })

  it('refuses when the runtime cannot resume its session', () => {
    assert.equal(shouldAttemptRepair({ ...base, canFollowUp: false }), false)
  })

  it('refuses when repair is switched off for the task', () => {
    assert.equal(shouldAttemptRepair({ ...base, maxAttempts: 0 }), false)
  })
})

describe('buildRepairPrompt', () => {
  const failures = [
    {
      name: 'Types',
      command: 'pnpm typecheck',
      outcome: 'failed' as const,
      exitCode: 2,
      output: "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    },
  ]

  it('names the failing check and its command', () => {
    const prompt = buildRepairPrompt(failures, 1)
    assert.match(prompt, /Types/)
    assert.match(prompt, /pnpm typecheck/)
    assert.match(prompt, /TS2322/)
    assert.match(prompt, /exit code 2/)
  })

  it('tells the agent not to weaken the check', () => {
    assert.match(buildRepairPrompt(failures, 1), /Do not disable, skip, or weaken/)
  })

  it('states which attempt this is', () => {
    assert.match(buildRepairPrompt(failures, 2), /repair attempt 2 of 3/)
  })

  it('describes a timeout differently from a non-zero exit', () => {
    const prompt = buildRepairPrompt(
      [{ ...failures[0], outcome: 'timeout', exitCode: null, output: '' }],
      1,
    )
    assert.match(prompt, /timed out/)
    assert.doesNotMatch(prompt, /exit code/)
  })

  it('omits an empty output block', () => {
    const prompt = buildRepairPrompt([{ ...failures[0], output: '   ' }], 1)
    assert.doesNotMatch(prompt, /Output:/)
  })

  it('lists every failing check', () => {
    const prompt = buildRepairPrompt(
      [failures[0], { ...failures[0], name: 'Tests', command: 'pnpm test' }],
      1,
    )
    assert.match(prompt, /Types/)
    assert.match(prompt, /Tests/)
  })
})
