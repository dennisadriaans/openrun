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

test('partial refreshes keep confirmed schedules and repeated stream events do not duplicate activity', () => {
  const session = new CliSession(null)
  session.updateOverview({ scheduled: 2, tasks: [{ id: 't', prompt: 'Test', when: 'Soon' }] })
  session.updateOverview({ integrations: 1, error: 'Worker unavailable' })
  assert.equal(session.overview.scheduled, 2)
  assert.equal(session.overview.tasks?.length, 1)
  session.runChanged('r', 'running')
  session.runChanged('r', 'running')
  session.runChanged('r', 'success')
  assert.equal(session.entries.length, 2)
})
