import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { taskWorkspaceChangeBlockedReason } from './taskIsolationGate.ts'

describe('taskWorkspaceChangeBlockedReason', () => {
  it('blocks while a run is active', () => {
    assert.match(
      taskWorkspaceChangeBlockedReason({ activeRunId: 'run-1', queuedCount: 0 }) ?? '',
      /run is in progress/,
    )
  })

  it('blocks while a fire is queued', () => {
    assert.match(
      taskWorkspaceChangeBlockedReason({ activeRunId: null, queuedCount: 1 }) ?? '',
      /run is queued/,
    )
  })

  it('allows an idle task', () => {
    assert.equal(taskWorkspaceChangeBlockedReason({ activeRunId: null, queuedCount: 0 }), null)
  })
})
