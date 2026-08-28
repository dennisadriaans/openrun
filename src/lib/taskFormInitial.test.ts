import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { taskFormInitial, type TaskFormInitialSource } from './taskFormInitial.ts'

const stored: TaskFormInitialSource = {
  id: 'task-1',
  name: 'Continue release work',
  description: 'One unattended follow-up',
  runtimeId: 'claude',
  prompt: 'Finish the release.',
  workspaceId: 'workspace-1',
  cron: '30 14 * * *',
  webhookIntegrationId: 'integration-1',
  webhookEvents: '["issue.updated"]',
  webhookFilters: '{"labels":["ship"]}',
  enabled: 1,
  model: 'opus',
  effort: 'high',
  verifyEnabled: 1,
  maxRepairAttempts: 2,
  timeoutMs: 900_000,
  resumeSessionId: 'session-1',
  resumeSessionLabel: 'Release chat',
  fireOnce: 1,
  scheduledAt: 1_700_000_100_000,
}

describe('taskFormInitial', () => {
  it('round-trips every persisted edit field', () => {
    assert.deepEqual(taskFormInitial(stored), {
      id: 'task-1',
      name: 'Continue release work',
      description: 'One unattended follow-up',
      runtimeId: 'claude',
      prompt: 'Finish the release.',
      workspaceId: 'workspace-1',
      cron: '30 14 * * *',
      webhookIntegrationId: 'integration-1',
      webhookEvents: ['issue.updated'],
      webhookFilters: {
        labels: ['ship'],
        projects: undefined,
        statuses: undefined,
        previousStatuses: undefined,
        assignees: undefined,
      },
      enabled: true,
      model: 'opus',
      effort: 'high',
      verifyEnabled: 1,
      maxRepairAttempts: 2,
      timeoutMs: 900_000,
      resumeSessionId: 'session-1',
      resumeSessionLabel: 'Release chat',
      fireOnce: 1,
      scheduledAt: 1_700_000_100_000,
    })
  })
})
