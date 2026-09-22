import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { describeIntent, previewRequest, RequestPreview } from './preview.ts'
import { interpretRequest, parseLocalRequest } from './natural.ts'
import { CLAUDE_MODELS } from '../../src/lib/models.ts'

test('preview distinguishes immediate launches from relative schedules with model and effort', () => {
  const catalogs = [{ runtime: 'claude' as const, models: CLAUDE_MODELS }]
  for (const timing of ['', 'in 10 minutes']) {
    const result = parseLocalRequest(
      [`create file test.html ${timing} sonnet low`],
      catalogs,
      'auto',
    )
    assert.ok(result)
    const preview = describeIntent(result)
    assert.match(
      preview,
      timing ? /Enter → Schedule · in 10 minutes/ : /Enter → Open Claude Code now/,
    )
    assert.match(preview, /Sonnet 5 · low effort · create file test.html/)
    assert.match(describeIntent(result, true), /Enter → Preview only/)
  }
})

test('typing is debounced and an older reply cannot replace the current preview', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const updates: string[] = []
  const pending: { text: string; signal: AbortSignal; resolve: (value: string) => void }[] = []
  const preview = new RequestPreview(
    (message) => updates.push(message),
    (text, signal) => new Promise((resolve) => pending.push({ text, signal, resolve })),
  )
  t.after(() => preview.cancel())
  preview.update('create a')
  t.mock.timers.tick(300)
  preview.update('create a file')
  t.mock.timers.tick(599)
  assert.equal(pending.length, 0)
  t.mock.timers.tick(1)
  assert.equal(pending[0]?.text, 'create a file')
  preview.update('review the changes')
  assert.equal(pending[0]?.signal.aborted, true)
  t.mock.timers.tick(600)
  pending[1]!.resolve('Current interpretation')
  await setImmediate()
  pending[0]!.resolve('Stale interpretation')
  await setImmediate()
  assert.equal(updates.at(-1), 'Current interpretation')
  assert.ok(!updates.includes('Stale interpretation'))
})

test('clearing the input or leaving a prompt cancels interpretation, and commands need no hosted call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let shown = ''
  let calls = 0
  let finish!: (value: string) => void
  let signal!: AbortSignal
  const preview = new RequestPreview(
    (message) => {
      shown = message
    },
    (_text, requestSignal) => {
      calls++
      signal = requestSignal
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  )
  t.after(() => preview.cancel())
  preview.update('run')
  assert.match(shown, /^Enter → Run a task\n.*Run a task/)
  t.mock.timers.tick(1000)
  assert.equal(calls, 0)
  preview.update('create a file')
  t.mock.timers.tick(600)
  preview.update('')
  assert.equal(signal.aborted, true)
  finish('Late result')
  await setImmediate()
  assert.equal(shown, '')
  preview.update('create another file')
  preview.cancel()
  t.mock.timers.tick(600)
  assert.equal(calls, 1)
})

test('exact and fuzzy suggestions stay visible after typing pauses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let shown = ''
  const preview = new RequestPreview(
    (message) => {
      shown = message
    },
    async () => assert.fail('Matching suggestions must stay visible without interpretation'),
  )
  t.after(() => preview.cancel())
  for (const [input, label] of [
    ['s', 'Schedule an automation'],
    ['sch', 'Schedule an automation'],
    ['schedule', 'Schedule an automation'],
    ['schedule an autromation', 'Schedule an automation'],
    ['setup a project', 'Set up a project'],
  ]) {
    preview.update(input!)
    t.mock.timers.tick(1000)
    assert.ok(shown.split('\n')[1]?.includes(label!), input)
  }
})

test('explicit commands and literal prompts can be previewed without hosted interpretation', async (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    assert.fail('Explicit input must stay local')
  })
  const preview = await previewRequest(
    'schedule --runtime claude --prompt "create a file" in 10 minutes',
    new AbortController().signal,
    () => {},
  )
  assert.match(preview, /Enter → Schedule/)
  assert.match(preview, /Claude Code/)
  assert.match(preview, /create a file/)
  assert.match(
    await previewRequest('run "create a file"', new AbortController().signal, () => {}),
    /Set up a managed run/,
  )
})

test('Enter reuses the hosted preview while relative timing is resolved from submission', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 22, 14, 0).getTime() })
  const originalUrl = process.env.OPENRUN_CLOUD_URL
  process.env.OPENRUN_CLOUD_URL = 'https://preview.example'
  t.after(() => {
    if (originalUrl === undefined) delete process.env.OPENRUN_CLOUD_URL
    else process.env.OPENRUN_CLOUD_URL = originalUrl
  })
  const text = 'create file preview.html in 10 seconds'
  const start = text.indexOf('in 10 seconds')
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({
      version: 1,
      action: 'schedule',
      runtime: 'claude',
      model: 'claude-sonnet-5',
      effort: 'low',
      prompt: { start: 0, end: start - 1 },
      schedule: { start, end: text.length },
      openPr: false,
      clarify: [],
    })
  })
  const preview = await interpretRequest(text, [], 'auto')
  assert.equal(preview.intent.schedule.kind, 'once')
  const started = Date.now()
  preview.intent.prompt = 'Mutated display data'
  t.mock.timers.tick(5000)
  const submitted = await interpretRequest(text, [], 'auto')
  assert.equal(calls, 1)
  assert.equal(submitted.intent.prompt, 'create file preview.html')
  assert.equal(submitted.intent.schedule.kind, 'once')
  if (submitted.intent.schedule.kind === 'once')
    assert.equal(submitted.intent.schedule.at, started + 15_000)
})
