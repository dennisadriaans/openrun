import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildConflictRepairPrompt,
  parseMergeable,
  PR_NO_CHECKS_GRACE_MS,
  PR_WATCH_IDLE_LIMIT_MS,
  prWatchDecision,
  shouldAutoShip,
  type PrWatchInput,
} from './autoShip.ts'

describe('shouldAutoShip', () => {
  const ship = { trigger: 'schedule', freshExecution: true, verdict: 'verified', canOpenPrs: true }

  it('ships a verified scheduled or webhook run from its own checkout', () => {
    assert.equal(shouldAutoShip({ ...ship, verdict: 'verified' }), true)
    assert.equal(shouldAutoShip({ ...ship, trigger: 'webhook', verdict: 'verified' }), true)
  })

  it('never ships work the checks did not verify', () => {
    for (const verdict of ['failed-checks', 'unverified', 'no-changes', 'crashed', ''] as const) {
      assert.equal(shouldAutoShip({ ...ship, verdict }), false, verdict)
    }
  })

  it('leaves attended runs, shared checkouts and runtimes without the capability alone', () => {
    assert.equal(shouldAutoShip({ ...ship, verdict: 'verified', trigger: 'manual' }), false)
    assert.equal(shouldAutoShip({ ...ship, verdict: 'verified', trigger: 'chat' }), false)
    assert.equal(shouldAutoShip({ ...ship, verdict: 'verified', freshExecution: false }), false)
    assert.equal(shouldAutoShip({ ...ship, verdict: 'verified', canOpenPrs: false }), false)
  })
})

describe('parseMergeable', () => {
  it('reads GitHub values and treats anything else as still computing', () => {
    assert.equal(parseMergeable('MERGEABLE'), 'mergeable')
    assert.equal(parseMergeable('CONFLICTING'), 'conflicting')
    assert.equal(parseMergeable('UNKNOWN'), 'unknown')
    assert.equal(parseMergeable(undefined), 'unknown')
  })
})

describe('prWatchDecision', () => {
  const base: PrWatchInput = {
    state: 'open',
    checks: 'passing',
    failingChecks: [],
    mergeable: 'mergeable',
    headSha: 'b',
    repairedSha: '',
    attemptsUsed: 0,
    maxAttempts: 2,
    busy: false,
    sinceActivityMs: 10 * 60_000,
  }
  const failing = { ...base, checks: 'failing' as const, failingChecks: [{ name: 'ci', url: '' }] }

  it('is ready once checks are green and GitHub can merge it', () => {
    assert.deepEqual(prWatchDecision(base), { kind: 'ready' })
  })

  it('ends the watch when the pull request is merged or closed', () => {
    assert.equal(prWatchDecision({ ...base, state: 'merged', busy: true }).kind, 'stop')
    assert.equal(prWatchDecision({ ...base, state: 'closed' }).kind, 'stop')
  })

  it('waits for a busy agent, pending checks and an uncomputed merge state', () => {
    assert.deepEqual(prWatchDecision({ ...failing, busy: true }), { kind: 'wait' })
    assert.deepEqual(prWatchDecision({ ...base, checks: 'pending' }), { kind: 'wait' })
    assert.deepEqual(prWatchDecision({ ...base, mergeable: 'unknown' }), { kind: 'wait' })
  })

  it('gives checks time to register before calling a check-less PR ready', () => {
    const fresh = { ...base, checks: 'none' as const, sinceActivityMs: 1_000 }
    assert.deepEqual(prWatchDecision(fresh), { kind: 'wait' })
    assert.deepEqual(prWatchDecision({ ...fresh, sinceActivityMs: PR_NO_CHECKS_GRACE_MS + 1 }), {
      kind: 'ready',
    })
  })

  it('repairs failing checks and conflicts, conflicts first', () => {
    assert.deepEqual(prWatchDecision(failing), { kind: 'repair', cause: 'ci' })
    assert.deepEqual(prWatchDecision({ ...failing, mergeable: 'conflicting' }), {
      kind: 'repair',
      cause: 'conflict',
    })
  })

  it('stops when attempts are used up or repairs are off', () => {
    const spent = prWatchDecision({ ...failing, attemptsUsed: 2, repairedSha: 'a' })
    assert.equal(spent.kind, 'stop')
    const off = prWatchDecision({ ...failing, maxAttempts: 0 })
    assert.equal(off.kind, 'stop')
    assert.match(off.kind === 'stop' ? off.reason : '', /turned off/)
  })

  it('never hands the agent the same head commit twice', () => {
    const decision = prWatchDecision({ ...failing, attemptsUsed: 1, repairedSha: 'b' })
    assert.equal(decision.kind, 'stop')
    assert.match(decision.kind === 'stop' ? decision.reason : '', /did not push a fix/)
  })

  it('gives up after the idle limit', () => {
    const decision = prWatchDecision({
      ...base,
      checks: 'pending',
      sinceActivityMs: PR_WATCH_IDLE_LIMIT_MS + 1,
    })
    assert.equal(decision.kind, 'stop')
  })
})

describe('buildConflictRepairPrompt', () => {
  it('asks for a rebase onto the base and forbids dropping the other side', () => {
    const prompt = buildConflictRepairPrompt({
      prNumber: 7,
      prUrl: 'https://github.com/o/r/pull/7',
      baseBranch: 'main',
    })
    assert.match(prompt, /#7/)
    assert.match(prompt, /rebase this branch onto `origin\/main`/)
    assert.match(prompt, /Do not drop the other side/)
    assert.match(prompt, /git rebase --abort/)
  })
})
