import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { CliSession } from './session.ts'

test('multiple requests and an asynchronous failure preserve chronological history and FIFO delivery', () => {
  const session = new CliSession(null)
  session.enqueue('schedule first')
  const first = session.take()
  session.begin(first)
  session.progress('Saving schedule')
  session.enqueue('schedule second')
  session.enqueue('runs')
  assert.equal(session.current?.text, 'schedule first')
  assert.equal(session.pending.length, 2)
  session.finish('Could not confirm the first schedule. Check automations before retrying.')
  const second = session.take()
  session.begin(second)
  session.log('assistant', 'Scheduled second')
  session.finish()
  assert.equal(second, 'schedule second')
  assert.equal(session.take(), 'runs')
  assert.deepEqual(
    session.entries.map((entry) => entry.text),
    [
      'schedule first',
      'schedule second',
      'runs',
      'Could not confirm the first schedule. Check automations before retrying.',
      'Scheduled second',
    ],
  )
  assert.equal(session.pending.length, 0)
})

test('a saved transcript contains results, survives a renderer replacement, and redacts credentials', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'openrun-session-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const session = new CliSession(join(directory, 'session.jsonl'))
  session.enqueue('openrun worker status --token "private-value"')
  session.begin(session.take())
  session.log('assistant', '{"token":"private-value","running":true}')
  session.finish()
  let notifications = 0
  const detach = session.subscribe(() => {
    notifications++
  })
  detach()
  session.draft = 'review checkout'
  const attach = session.subscribe(() => {
    notifications++
  })
  session.log('system', 'Returned from coding agent')
  attach()
  assert.equal(notifications, 1)
  assert.equal(session.draft, 'review checkout')
  const saved = readFileSync(session.file!, 'utf8')
  assert.equal(saved.includes('private-value'), false)
  assert.deepEqual(
    saved
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    session.entries,
  )
  if (process.platform !== 'win32') assert.equal(statSync(session.file!).mode & 0o777, 0o600)
})

test('a scheduled task updates in place through running and success, including partial refreshes', () => {
  const session = new CliSession(null)
  const task = {
    id: 't',
    prompt: 'Create a file with the requested contents',
    when: '09:15',
    model: 'sonnet',
    effort: 'low',
  }
  session.updateOverview({ scheduled: 1, tasks: [task] })
  session.updateOverview({ integrations: 1, error: 'Worker unavailable' })
  assert.equal(session.overview.scheduled, 1)
  assert.deepEqual(session.activity, [
    { prompt: task.prompt, status: 'Scheduled', time: '09:15', model: 'sonnet', effort: 'low' },
  ])
  session.runChanged('r', 'running')
  session.runChanged('r', 'running')
  // The event has no name; keep the task until its run metadata arrives.
  assert.equal(session.activity.length, 1)
  const run = {
    id: 'r',
    taskId: 't',
    prompt: 'Create a file…',
    when: 'Running',
    startedAt: Date.now(),
    time: '09:15:02',
  }
  session.updateOverview({ tasks: [], activeRuns: [run] })
  assert.equal(session.activity.length, 1)
  assert.equal(session.activity[0]?.status, 'Running')
  assert.equal(session.activity[0]?.prompt, task.prompt)
  session.runChanged('r', 'success')
  session.updateOverview({ activeRuns: [], recentRuns: [{ ...run, when: 'Success' }] })
  assert.equal(session.activity.length, 1)
  assert.equal(session.activity[0]?.status, 'Success')
  assert.equal(session.activity[0]?.prompt, task.prompt)
  assert.equal(session.activity[0]?.time, '09:15:02')
  assert.equal(session.activity[0]?.model, 'sonnet')
  assert.equal(session.activity[0]?.effort, 'low')
  assert.equal(session.entries.length, 0)
})

test('a fast failed run gets its name from the refresh without exposing an ID-only item', () => {
  const session = new CliSession(null)
  session.runChanged('r', 'running')
  session.runChanged('r', 'error')
  assert.equal(session.activity.length, 0)
  session.updateOverview({
    recentRuns: [{ id: 'r', prompt: 'Check dependencies', when: 'Failed' }],
  })
  assert.equal(session.activity.length, 1)
  assert.equal(session.activity[0]?.prompt, 'Check dependencies')
  assert.equal(session.activity[0]?.status, 'Failed')
})

test('recurring tasks keep the latest run and next time without duplicate status items', () => {
  const session = new CliSession(null)
  const task = { id: 't', prompt: 'Daily review', when: 'Tomorrow 09:00' }
  const first = { id: 'r1', taskId: 't', prompt: task.prompt, when: 'Running', startedAt: 1 }
  const second = { ...first, id: 'r2', startedAt: 2 }
  session.updateOverview({ tasks: [task], activeRuns: [first] })
  session.runChanged('r1', 'success')
  session.updateOverview({ activeRuns: [second], recentRuns: [{ ...first, when: 'Success' }] })
  assert.equal(session.activity.length, 1)
  assert.equal(session.activity[0]?.runId, 'r2')
  assert.equal(session.activity[0]?.status, 'Running')
  assert.equal(session.activity[0]?.nextTime, 'Tomorrow 09:00')
  session.runChanged('r1', 'success')
  assert.equal(session.activity[0]?.status, 'Running')
  session.runChanged('r2', 'error')
  assert.equal(session.activity[0]?.status, 'Failed')
})

test('cancelled queue entries disappear instead of staying queued indefinitely', () => {
  const session = new CliSession(null)
  session.updateOverview({
    activeRuns: [{ id: 'q', taskId: 't', prompt: 'Review', when: 'Queued' }],
  })
  assert.equal(session.activity.length, 1)
  session.updateOverview({ activeRuns: [] })
  assert.deepEqual(session.activity, [])
})

test('a clicked review leaves no chat trail, and finished runs report their changes once', () => {
  const session = new CliSession(null)
  session.enqueue('review run-1', true)
  session.begin('review run-1')
  assert.equal(session.pending.length, 0)
  assert.equal(session.current?.silent, true)
  session.finish()
  assert.deepEqual(session.entries, [])

  session.updateOverview({
    activeRuns: [
      { id: 'run-2', prompt: 'create foo.html', when: 'Running', startedAt: Date.now() },
    ],
  })
  assert.deepEqual(session.takeRunsAwaitingChanges(), [])
  session.runChanged('run-2', 'success')
  assert.deepEqual(session.takeRunsAwaitingChanges(), ['run-2'])
  assert.deepEqual(session.takeRunsAwaitingChanges(), [])
  session.runChanges('run-2', { files: 1, additions: 3, deletions: 0 })
  session.updateOverview({
    activeRuns: [],
    recentRuns: [
      { id: 'run-2', prompt: 'create foo.html', when: 'Success', startedAt: Date.now() },
    ],
  })
  assert.deepEqual(session.activity[0]?.changes, { files: 1, additions: 3, deletions: 0 })
})
