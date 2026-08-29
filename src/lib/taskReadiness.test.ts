import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { taskReadinessBlockers } from './taskReadiness.ts'

const ready = {
  enabled: true,
  cron: '0 9 * * *',
  cronValid: true,
  workspaceValid: true,
  workspaceReady: true,
  runtimeInstalled: true,
  promptValid: true,
  promptDeliveryValid: true,
  resumeSessionValid: true,
  triggerReady: true,
  verifyEnabled: true,
  checkCount: 1,
  webhookIntegrationId: '',
}

describe('taskReadinessBlockers', () => {
  it('reports every applicable blocker in repair order', () => {
    const blockers = taskReadinessBlockers({
      ...ready,
      workspaceValid: false,
      workspaceReady: false,
      runtimeInstalled: false,
      promptValid: false,
      promptDeliveryValid: false,
      resumeSessionId: 'gone',
      resumeSessionValid: false,
      cron: 'not cron',
      cronValid: false,
      webhookIntegrationId: 'connection-1',
      triggerReady: false,
      triggerBlockReason: 'Webhook connection is disabled.',
      verifyEnabled: false,
      checkCount: 0,
      unattendedBlockedReason: 'The workspace is shared.',
      supervisionBlockedReason: 'Supervised runs need a human.',
    })

    assert.deepEqual(
      blockers.map((blocker) => blocker.id),
      [
        'workspace',
        'runtime',
        'prompt',
        'resume',
        'cron',
        'trigger',
        'verification-disabled',
        'verification-checks',
        'unattended',
        'supervision',
      ],
    )
  })

  it('does not apply unattended checks to a manual-only task', () => {
    const blockers = taskReadinessBlockers({
      ...ready,
      cron: '',
      webhookIntegrationId: '',
      verifyEnabled: false,
      checkCount: 0,
      unattendedBlockedReason: 'shared checkout',
    })
    assert.deepEqual(blockers, [])
  })

  it('requires a valid absolute fire time for one-shot automations', () => {
    const missingCron = taskReadinessBlockers({ ...ready, cron: '', fireOnce: 1 })
    assert.equal(missingCron[0]?.id, 'one-shot')
    const missingTime = taskReadinessBlockers({
      ...ready,
      fireOnce: 1,
      scheduledAt: 0,
    })
    assert.equal(missingTime[0]?.id, 'one-shot')
  })

  it('distinguishes missing prompt text from an invalid delivery channel', () => {
    const prompt = taskReadinessBlockers({ ...ready, promptValid: false })
    assert.equal(prompt[0]?.id, 'prompt')
    const channel = taskReadinessBlockers({
      ...ready,
      promptDeliveryValid: false,
      promptDeliveryReason: 'Prompt is never sent.',
    })
    assert.deepEqual(
      channel.map((blocker) => blocker.id),
      ['prompt-delivery'],
    )
    assert.equal(channel[0]?.message, 'Prompt is never sent.')
  })
})
