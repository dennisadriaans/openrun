import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resumesSavedSession, usesFreshExecution } from './executionWorkspace.ts'

describe('execution workspace policy', () => {
  it('keeps attended runs in the selected checkout', () => {
    assert.equal(usesFreshExecution({ trigger: 'interactive' }), false)
    assert.equal(usesFreshExecution({ trigger: 'chat' }), false)
    assert.equal(usesFreshExecution({ trigger: 'manual' }), false)
  })

  it('gives every scheduled fire its own execution checkout', () => {
    assert.equal(usesFreshExecution({ trigger: 'schedule' }), true)
    assert.equal(usesFreshExecution({ trigger: 'schedule', resumeSessionId: '  ' }), true)
    assert.equal(resumesSavedSession({ trigger: 'schedule' }), false)
  })

  it('continues a saved chat in its own checkout', () => {
    const input = { trigger: 'schedule', resumeSessionId: 'sess-1' }
    assert.equal(usesFreshExecution(input), false)
    assert.equal(resumesSavedSession(input), true)
  })

  it('isolates webhook deliveries and starts their conversation fresh', () => {
    assert.equal(usesFreshExecution({ trigger: 'webhook' }), true)
    assert.equal(usesFreshExecution({ trigger: 'webhook', resumeSessionId: 'sess-1' }), true)
    assert.equal(resumesSavedSession({ trigger: 'webhook', resumeSessionId: 'sess-1' }), false)
    assert.equal(resumesSavedSession({ trigger: 'manual', resumeSessionId: 'sess-1' }), true)
  })
})
