import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildCiRepairPrompt, canRepairCi, ciRepairLabel, ciRepairRefusal } from './ciRepair.ts'
import type { FailingCheck } from './pullRequest.ts'

const failing: FailingCheck[] = [
  { name: 'CI / typecheck', url: 'https://github.com/o/r/actions/runs/1' },
  { name: 'CI / test', url: '' },
]

function input(overrides: Partial<Parameters<typeof ciRepairRefusal>[0]> = {}) {
  return {
    state: 'open' as const,
    checks: 'failing',
    failingChecks: failing,
    busy: false,
    ...overrides,
  }
}

describe('ciRepairRefusal', () => {
  it('allows a repair on an open pull request with red checks', () => {
    assert.equal(ciRepairRefusal(input()), null)
    assert.equal(canRepairCi(input()), true)
  })

  it('allows it on a draft too — a draft PR still runs CI', () => {
    assert.equal(ciRepairRefusal(input({ state: 'draft' })), null)
  })

  it('refuses once the pull request has been merged or closed', () => {
    assert.match(String(ciRepairRefusal(input({ state: 'merged' }))), /already merged/)
    assert.match(String(ciRepairRefusal(input({ state: 'closed' }))), /closed/)
  })

  it('refuses while the checks are still running', () => {
    assert.match(String(ciRepairRefusal(input({ checks: 'pending' }))), /still running/)
  })

  it('refuses when nothing is actually red', () => {
    assert.match(String(ciRepairRefusal(input({ checks: 'passing' }))), /No check/)
    assert.match(String(ciRepairRefusal(input({ checks: 'none' }))), /No check/)
    // A row cached before failing checks were recorded: red, but nothing named.
    assert.match(String(ciRepairRefusal(input({ failingChecks: [] }))), /No check/)
  })

  it('refuses while the agent is mid-turn', () => {
    assert.match(String(ciRepairRefusal(input({ busy: true }))), /still working/)
  })

  it('reports a settled pull request ahead of a busy agent', () => {
    // Ordering matters for the hover text: "merged" is the useful reason.
    assert.match(String(ciRepairRefusal(input({ state: 'merged', busy: true }))), /merged/)
  })
})

describe('buildCiRepairPrompt', () => {
  const prompt = buildCiRepairPrompt({
    prNumber: 42,
    prUrl: 'https://github.com/o/r/pull/42',
    failingChecks: failing,
  })

  it('names the pull request it is talking about', () => {
    assert.match(prompt, /#42/)
    assert.match(prompt, /https:\/\/github\.com\/o\/r\/pull\/42/)
  })

  it('lists every failing check, with a link when there is one', () => {
    assert.match(prompt, /- CI \/ typecheck — https:\/\/github\.com\/o\/r\/actions\/runs\/1/)
    assert.match(prompt, /- CI \/ test$/m)
  })

  it('sends the agent to the logs rather than pasting them', () => {
    assert.match(prompt, /gh pr checks 42/)
    assert.match(prompt, /--log-failed/)
  })

  it('forbids the shortcuts an agent reaches for when told to make CI green', () => {
    assert.match(prompt, /Do not disable, skip, or weaken a check/)
    assert.match(prompt, /do not edit the CI configuration/)
    assert.match(prompt, /pre-existing/)
  })

  it('asks for the fix to be pushed, since CI only re-runs on a push', () => {
    assert.match(prompt, /push the fix to this branch/)
  })
})

describe('ciRepairLabel', () => {
  it('counts the checks so the button says what it will do', () => {
    assert.equal(ciRepairLabel([failing[0]!]), 'Fix failing check')
    assert.equal(ciRepairLabel(failing), 'Fix 2 failing checks')
  })
})
