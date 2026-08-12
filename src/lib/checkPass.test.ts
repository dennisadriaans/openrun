import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  countFailingChecks,
  isPassStale,
  latestPass,
  type CheckPassRow,
} from './checkPass.ts'

function row(partial: Partial<CheckPassRow> & { messageId: string }): CheckPassRow {
  return { attempt: 0, outcome: 'passed', startedAt: 0, ...partial }
}

describe('latestPass', () => {
  it('returns nothing for no results', () => {
    assert.deepEqual(latestPass([]), [])
  })

  it('keeps two ordinary turns apart even though both are attempt 0', () => {
    const results = [
      row({ messageId: 'm1', startedAt: 10, outcome: 'failed' }),
      row({ messageId: 'm2', startedAt: 20, outcome: 'failed' }),
      row({ messageId: 'm2', startedAt: 21, outcome: 'skipped' }),
    ]
    assert.deepEqual(
      latestPass(results).map((r) => r.startedAt),
      [20, 21],
    )
    assert.equal(countFailingChecks(results), 1)
  })

  it('prefers the highest repair attempt', () => {
    const results = [
      row({ messageId: 'm1', attempt: 0, startedAt: 99, outcome: 'failed' }),
      row({ messageId: 'm2', attempt: 1, startedAt: 5, outcome: 'passed' }),
    ]
    assert.deepEqual(
      latestPass(results).map((r) => r.messageId),
      ['m2'],
    )
    assert.equal(countFailingChecks(results), 0)
  })

  it('falls back to attempt grouping for legacy rows with no messageId', () => {
    const results = [
      row({ messageId: '', startedAt: 1, outcome: 'failed' }),
      row({ messageId: '', startedAt: 2, outcome: 'skipped' }),
    ]
    assert.equal(latestPass(results).length, 2)
  })
})

describe('isPassStale', () => {
  it('is stale when the newest pass verified an earlier turn', () => {
    const results = [row({ messageId: 'm1', startedAt: 1 })]
    assert.equal(isPassStale(results, 'm2'), true)
    assert.equal(isPassStale(results, 'm1'), false)
  })

  it('never guesses without both ids', () => {
    assert.equal(isPassStale([row({ messageId: '' })], 'm2'), false)
    assert.equal(isPassStale([row({ messageId: 'm1' })], ''), false)
    assert.equal(isPassStale([], 'm2'), false)
  })
})
