import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canUndoRunCommits,
  NO_RUN_COMMITS,
  shortSha,
  undoCommitsBlockedReason,
  undoCommitsLabel,
  type RunCommitSummary,
} from './undoRun.ts'

const summary = (over: Partial<RunCommitSummary> = {}): RunCommitSummary => ({
  baseCommit: 'a'.repeat(40),
  commits: [
    { sha: 'b'.repeat(40), subject: 'feat: add thing' },
    { sha: 'c'.repeat(40), subject: 'fix: the thing' },
  ],
  published: 0,
  ...over,
})

describe('undoCommitsBlockedReason', () => {
  it('allows dropping local-only commits', () => {
    assert.equal(undoCommitsBlockedReason(summary()), null)
    assert.equal(canUndoRunCommits(summary()), true)
  })

  it('blocks a run that committed nothing', () => {
    assert.match(undoCommitsBlockedReason(NO_RUN_COMMITS) ?? '', /no commits/i)
    assert.equal(canUndoRunCommits(summary({ commits: [] })), false)
  })

  it('blocks when every commit is already on a remote', () => {
    const reason = undoCommitsBlockedReason(summary({ published: 2 })) ?? ''
    assert.match(reason, /already on a remote/i)
    assert.match(reason, /revert/i)
  })

  it('names the count when only some commits are published', () => {
    assert.match(undoCommitsBlockedReason(summary({ published: 1 })) ?? '', /^1 of these/)
  })

  it('blocks when the base commit is no longer reachable', () => {
    assert.match(undoCommitsBlockedReason(summary({ baseCommit: '' })) ?? '', /branch has moved/i)
  })

  it('reports a published conflict before a missing base', () => {
    assert.match(
      undoCommitsBlockedReason(summary({ baseCommit: '', published: 2 })) ?? '',
      /already on a remote/i,
    )
  })
})

describe('undoCommitsLabel', () => {
  it('agrees in number', () => {
    assert.equal(undoCommitsLabel(summary()), 'Also drop the 2 commits this run made')
    assert.equal(
      undoCommitsLabel(summary({ commits: [{ sha: 'd'.repeat(40), subject: 'one' }] })),
      'Also drop the commit this run made',
    )
  })
})

describe('shortSha', () => {
  it('trims to the usual seven', () => {
    assert.equal(shortSha('0123456789abcdef'), '0123456')
  })
})
