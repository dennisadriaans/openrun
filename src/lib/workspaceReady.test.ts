import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertWorkspaceReady,
  isWorkspaceReady,
  workspaceNotReadyMessage,
} from './workspaceReady.ts'

describe('isWorkspaceReady', () => {
  it('is true only for ready', () => {
    assert.equal(isWorkspaceReady('ready'), true)
    assert.equal(isWorkspaceReady('creating'), false)
    assert.equal(isWorkspaceReady('error'), false)
    assert.equal(isWorkspaceReady('archived'), false)
    assert.equal(isWorkspaceReady(undefined), false)
    assert.equal(isWorkspaceReady(null), false)
    assert.equal(isWorkspaceReady(''), false)
  })
})

describe('workspaceNotReadyMessage', () => {
  it('explains creating and error with a Projects next step', () => {
    assert.match(workspaceNotReadyMessage('creating'), /still being set up/i)
    assert.match(workspaceNotReadyMessage('creating'), /under Projects/)
    assert.match(workspaceNotReadyMessage('error'), /failed setup/i)
    assert.match(workspaceNotReadyMessage('error'), /under Projects/)
  })

  it('does not point at a Projects page that no longer exists', () => {
    for (const status of [null, '', 'creating', 'error'] as const) {
      assert.doesNotMatch(workspaceNotReadyMessage(status), /Projects page/i)
    }
  })

  it('keeps the archived wording used by resolveWorkspacePath', () => {
    assert.equal(workspaceNotReadyMessage('archived'), 'Workspace is archived')
  })

  it('handles missing / unknown status', () => {
    assert.match(workspaceNotReadyMessage(null), /not found/i)
    assert.match(workspaceNotReadyMessage(null), /under Projects/)
    assert.match(workspaceNotReadyMessage(''), /not found/i)
    assert.match(workspaceNotReadyMessage('weird'), /status: weird/)
  })
})

describe('assertWorkspaceReady', () => {
  it('passes for ready', () => {
    assert.doesNotThrow(() => assertWorkspaceReady('ready'))
  })

  it('throws the shared message for creating / error', () => {
    assert.throws(
      () => assertWorkspaceReady('creating'),
      (err: Error) => {
        assert.equal(err.message, workspaceNotReadyMessage('creating'))
        return true
      },
    )
    assert.throws(
      () => assertWorkspaceReady('error'),
      (err: Error) => {
        assert.equal(err.message, workspaceNotReadyMessage('error'))
        return true
      },
    )
  })
})
