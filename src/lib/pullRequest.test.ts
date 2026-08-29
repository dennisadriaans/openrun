import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseGhPullRequestListResult,
  parseGhPullRequestResult,
  rollupChecks,
} from './pullRequest.ts'

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      number: 42,
      url: 'https://github.com/example/project/pull/42',
      title: 'Ship it',
      state: 'OPEN',
      isDraft: false,
      statusCheckRollup: [],
      ...overrides,
    },
  ])
}

describe('parseGhPullRequestListResult', () => {
  it('accepts open, draft, merged and closed pull requests', () => {
    const states = [
      [response(), 'open'],
      [response({ isDraft: true }), 'draft'],
      [response({ state: 'MERGED' }), 'merged'],
      [response({ state: 'CLOSED' }), 'closed'],
    ] as const
    for (const [output, expected] of states) {
      const result = parseGhPullRequestListResult(output)
      assert.equal(result.kind, 'found')
      if (result.kind === 'found') assert.equal(result.pullRequest.state, expected)
    }
  })

  it('accepts an authoritative empty array as no pull request', () => {
    assert.deepEqual(parseGhPullRequestListResult('[]'), { kind: 'none' })
  })

  it('rejects malformed, null, non-array and multiple results', () => {
    for (const output of ['not json', 'null', '{}', '[null, null]']) {
      assert.equal(parseGhPullRequestListResult(output).kind, 'invalid', output)
    }
  })

  it('rejects unknown state and invalid status rollups', () => {
    assert.equal(parseGhPullRequestListResult(response({ state: 'REOPENED' })).kind, 'invalid')
    for (const statusCheckRollup of [null, {}, [null], [{}]]) {
      assert.equal(
        parseGhPullRequestListResult(response({ statusCheckRollup })).kind,
        'invalid',
        JSON.stringify(statusCheckRollup),
      )
    }
    for (const node of [
      { status: 'UNKNOWN' },
      { conclusion: 'UNKNOWN' },
      { state: 'UNKNOWN' },
      { status: null },
      { status: 'COMPLETED', conclusion: null },
    ]) {
      assert.equal(
        parseGhPullRequestListResult(response({ statusCheckRollup: [node] })).kind,
        'invalid',
        JSON.stringify(node),
      )
    }
  })

  it('rejects invalid required fields', () => {
    assert.equal(parseGhPullRequestListResult(response({ number: '42' })).kind, 'invalid')
    assert.equal(parseGhPullRequestListResult(response({ isDraft: null })).kind, 'invalid')
    assert.equal(parseGhPullRequestListResult(response({ url: null })).kind, 'invalid')
  })
})

describe('pull request check rollup', () => {
  it('uses the worst check result and recognizes pending status', () => {
    assert.equal(rollupChecks([{ conclusion: 'SUCCESS' }]), 'passing')
    assert.equal(rollupChecks([{ conclusion: 'SUCCESS' }, { state: 'FAILURE' }]), 'failing')
    for (const status of ['IN_PROGRESS', 'QUEUED', 'REQUESTED', 'WAITING']) {
      assert.equal(rollupChecks([{ status, conclusion: null }]), 'pending', status)
    }
    assert.equal(rollupChecks([]), 'none')
  })
})

describe('parseGhPullRequestResult', () => {
  it('parses a single validated object for compatibility callers', () => {
    const result = parseGhPullRequestResult(response().slice(1, -1))
    assert.equal(result.kind, 'found')
    if (result.kind === 'found') assert.equal(result.pullRequest.number, 42)
  })
})
