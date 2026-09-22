import assert from 'node:assert/strict'
import { test } from 'node:test'
import { showHome, taskTiming, type TaskRowView } from './home.ts'

test('home uses server timestamps and readiness instead of predicting blocked cron fires', () => {
  const task: TaskRowView = {
    id: 'task',
    name: 'Sweep',
    enabled: 1,
    cron: '* * * * *',
    nextRunAt: null,
  }
  assert.equal(taskTiming(task), 'No next run scheduled')
  assert.equal(
    taskTiming({ ...task, readinessBlockers: [{ message: 'Agent not installed' }] }),
    'Needs attention · Agent not installed',
  )
  assert.equal(taskTiming({ ...task, enabled: 0, nextRunAt: Date.now() }), 'Paused')
  assert.equal(
    taskTiming({ ...task, cron: '', webhookIntegrationId: 'github' }),
    'On integration event',
  )
})

test('home shows running, scheduled and automation counts inline', async () => {
  let overview = ''
  const calls: string[] = []
  const tasks = [
    { id: 'later', name: 'Later', enabled: 1, nextRunAt: 2_000_000_100_000 },
    { id: 'earlier', name: 'Earlier', enabled: 1, nextRunAt: 2_000_000_000_000 },
    { id: 'paused', name: 'Paused task', enabled: 0, nextRunAt: null },
  ]
  await showHome(
    {
      async call(operation) {
        calls.push(operation)
        if (operation === 'tasks.list') return tasks
        if (operation === 'dashboard.dashboard') return { stats: { running: 1 } }
        throw new Error(`Unexpected operation: ${operation}`)
      },
    },
    {
      info() {},
      scheduledTasks() {},
      note(message) {
        overview = message
      },
    },
  )
  assert.equal(overview, 'Running now 1   ·   Scheduled 2   ·   Automations 3')
  assert.deepEqual(calls.sort(), ['dashboard.dashboard', 'tasks.list'])
})
