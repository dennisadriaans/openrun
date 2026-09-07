import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resumesSavedSession, usesFreshExecution } from './executionWorkspace.ts'

describe('execution workspace policy', () => {
  it('reuses selected workspaces for interactive, manual, and scheduled runs', () => {
    assert.equal(usesFreshExecution('interactive'), false)
    assert.equal(usesFreshExecution('manual'), false)
    assert.equal(usesFreshExecution('schedule'), false)
  })

  it('isolates webhook deliveries and starts their conversation fresh', () => {
    assert.equal(usesFreshExecution('webhook'), true)
    assert.equal(resumesSavedSession('webhook'), false)
    assert.equal(resumesSavedSession('manual'), true)
    assert.equal(resumesSavedSession('schedule'), true)
  })
})
