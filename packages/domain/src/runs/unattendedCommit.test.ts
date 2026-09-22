import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  shouldCommitUnattendedChanges,
  unattendedCommitFailedMessage,
  unattendedCommitMessage,
} from './unattendedCommit.ts'

describe('shouldCommitUnattendedChanges', () => {
  it('commits a dirty app-managed worktree after a verified run', () => {
    assert.equal(
      shouldCommitUnattendedChanges({
        workspaceKind: 'worktree',
        dirty: true,
        verdict: 'verified',
      }),
      true,
    )
  })

  it('commits after a bad verdict too, so the work survives the quarantine', () => {
    for (const verdict of ['failed-checks', 'crashed', 'timeout', 'unverified'] as const) {
      assert.equal(
        shouldCommitUnattendedChanges({ workspaceKind: 'worktree', dirty: true, verdict }),
        true,
        `expected ${verdict} to commit`,
      )
    }
  })

  it('never touches the main checkout', () => {
    assert.equal(
      shouldCommitUnattendedChanges({ workspaceKind: 'main', dirty: true, verdict: 'verified' }),
      false,
    )
  })

  it('does nothing when the tree is already clean', () => {
    assert.equal(
      shouldCommitUnattendedChanges({
        workspaceKind: 'worktree',
        dirty: false,
        verdict: 'verified',
      }),
      false,
    )
  })

  it('leaves a cancelled run exactly as the person left it', () => {
    assert.equal(
      shouldCommitUnattendedChanges({ workspaceKind: 'worktree', dirty: true, verdict: '' }),
      false,
    )
  })
})

describe('unattendedCommitMessage', () => {
  it('names the automation, the verdict and the run to undo from', () => {
    const message = unattendedCommitMessage({
      taskName: 'Nightly changelog',
      verdict: 'verified',
      runId: 'run_123',
    })
    assert.match(message, /Nightly changelog/)
    assert.match(message, /\(verified\)/)
    assert.match(message, /run_123/)
  })

  it('falls back to a generic name for an unnamed automation', () => {
    const message = unattendedCommitMessage({ taskName: '   ', verdict: 'crashed', runId: 'r1' })
    assert.match(message, /a scheduled run/)
  })

  it('keeps the subject on the first line', () => {
    const subject = unattendedCommitMessage({
      taskName: 'Docs sweep',
      verdict: 'verified',
      runId: 'r1',
    }).split('\n')[0]
    assert.equal(subject, 'chore(openrun): Docs sweep (verified)')
  })
})

describe('unattendedCommitFailedMessage', () => {
  it('explains where partial output is retained', () => {
    const message = unattendedCommitFailedMessage('Nothing staged to commit')
    assert.match(message, /Nothing staged to commit/)
    assert.match(message, /retained for recovery/)
  })
})
