import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HomeOverview } from '../session/session.ts'
import { showHome, taskTiming, watchHome, type TaskRowView } from './home.ts'
import { setImmediate } from 'node:timers/promises'
import type { watchActivity } from '../session/activity.ts'

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
  // The scheduler disables a one-off after firing it; that is done, not paused.
  const fired = { ...task, enabled: 0, fireOnce: 1, lastRunAt: Date.now() }
  assert.match(taskTiming(fired), /^Ran \d/)
  assert.equal(taskTiming({ ...fired, lastRunAt: null }), 'Paused')
  assert.equal(
    taskTiming({ ...task, cron: '', webhookIntegrationId: 'github' }),
    'On integration event',
  )
})

test('home shows running, scheduled and automation counts inline', async () => {
  let overview: HomeOverview = {}
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
        if (operation === 'dashboard.dashboard')
          return {
            stats: { running: 1, runsToday: 4 },
            activeRuns: [{ id: 'running', taskName: 'Test', status: 'running' }],
          }
        if (operation === 'integrations.list') return [{ enabled: 1 }, { enabled: 0 }]
        throw new Error(`Unexpected operation: ${operation}`)
      },
    },
    {
      overview(value) {
        overview = value
      },
    },
  )
  assert.equal(overview.running, 1)
  assert.equal(overview.scheduled, 2)
  assert.equal(overview.runs, 4)
  assert.equal(overview.integrations, 1)
  assert.deepEqual(
    overview.tasks?.map((row) => row.id),
    ['earlier', 'later'],
  )
  assert.equal(overview.activeRuns?.[0]?.id, 'running')
  assert.deepEqual(calls.sort(), ['dashboard.dashboard', 'integrations.list', 'tasks.list'])
})

test('background refreshes discard older responses and stop updating after the session closes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let stream!: Parameters<typeof watchActivity>[0]
  let stopped = false
  let release!: (value: TaskRowView[]) => void
  let reads = 0
  const views: HomeOverview[] = []
  const live = watchHome(
    {
      async call(operation) {
        if (operation === 'tasks.list') {
          reads++
          if (reads === 1)
            return new Promise<TaskRowView[]>((resolve) => {
              release = resolve
            })
          return [{ id: 'new', name: 'New schedule', enabled: 1, nextRunAt: 2_000_000_000_000 }]
        }
        if (operation === 'integrations.list') return []
        return { stats: { running: 1, runsToday: 2 } }
      },
    },
    {
      overview(value) {
        views.push(value)
      },
      status() {},
      runChanged() {},
    },
    {
      watch(options) {
        stream = options
        return () => {
          stopped = true
        }
      },
    },
  )
  t.after(() => live.stop())
  // A save or stream event invalidates the old read before it resolves.
  stream.onChange()
  release([])
  await setImmediate()
  assert.equal(views.length, 0)
  t.mock.timers.tick(100)
  await setImmediate()
  assert.equal(views[0]?.tasks?.[0]?.id, 'new')
  live.stop()
  live.refresh()
  t.mock.timers.tick(10_000)
  await setImmediate()
  assert.equal(stopped, true)
  assert.equal(views.length, 1)
})

test('a partial failure does not replace already visible sections with zeroes', async () => {
  let update: HomeOverview = {}
  await showHome(
    {
      async call(operation) {
        if (operation === 'integrations.list') return [{ enabled: true }]
        throw new Error('Connection interrupted')
      },
    },
    {
      overview(view) {
        update = view
      },
    },
  )
  assert.equal(update.integrations, 1)
  assert.equal('tasks' in update, false)
  assert.equal('running' in update, false)
  assert.match(update.error!, /Connection interrupted/)
})
