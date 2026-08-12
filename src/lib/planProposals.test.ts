import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  looksLikePlanProposalArray,
  parsePlanProposals,
  proposalFingerprint,
} from './planProposals.ts'

describe('parsePlanProposals', () => {
  it('parses a bare JSON array', () => {
    const raw = JSON.stringify([
      {
        name: 'stale-open-pr-scan',
        description: 'Daily scan',
        prompt: 'List open PRs',
        cron: '0 9 * * 1-5',
      },
    ])
    assert.deepEqual(parsePlanProposals(raw), [
      {
        name: 'stale-open-pr-scan',
        description: 'Daily scan',
        prompt: 'List open PRs',
        cron: '0 9 * * 1-5',
      },
    ])
  })

  it('extracts an array wrapped in noise', () => {
    const raw = 'Here you go:\n[{"name":"a","prompt":"do it","cron":"0 * * * *"}]\nThanks'
    assert.equal(parsePlanProposals(raw).length, 1)
    assert.equal(parsePlanProposals(raw)[0]!.name, 'a')
  })

  it('drops entries without a string prompt', () => {
    assert.deepEqual(parsePlanProposals('[{"name":"x","cron":"* * * * *"}]'), [])
  })

  it('returns [] for non-JSON', () => {
    assert.deepEqual(parsePlanProposals('no array here'), [])
  })
})

describe('looksLikePlanProposalArray', () => {
  it('is true for valid planner JSON', () => {
    assert.equal(
      looksLikePlanProposalArray('[{"name":"a","prompt":"x","cron":"0 9 * * *"}]'),
      true,
    )
  })

  it('is false for empty / unrelated JSON', () => {
    assert.equal(looksLikePlanProposalArray('[]'), false)
    assert.equal(looksLikePlanProposalArray('{"hello":1}'), false)
  })
})

describe('proposalFingerprint', () => {
  it('changes when name, cron, or prompt changes', () => {
    const base = { name: 'a', cron: '0 9 * * *', prompt: 'do' }
    assert.notEqual(proposalFingerprint(base), proposalFingerprint({ ...base, name: 'b' }))
    assert.notEqual(proposalFingerprint(base), proposalFingerprint({ ...base, cron: '0 10 * * *' }))
    assert.notEqual(proposalFingerprint(base), proposalFingerprint({ ...base, prompt: 'other' }))
  })
})
