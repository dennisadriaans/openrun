import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseSchedule, guideRun, selectRuntime, selectWorkspace } from './guided.ts'
import { Back, Cancelled, type Choice, type FlowUi } from '../terminal/ui.ts'
import type { CliClient } from '../runtime/local.ts'

function terminal(
  answers: (string | Error)[] = [],
  textAnswers: (string | Error)[] = [],
  preferredRuntime = 'codex',
) {
  const selections: { message: string; value: string }[] = []
  const texts: { message: string; initial: string }[] = []
  const ui: FlowUi = {
    interactive: true,
    preferredRuntime,
    info() {},
    note() {},
    async select(message: string, choices: Choice[], initial = choices[0]?.value) {
      const value = answers.shift() ?? initial!
      if (value instanceof Error) throw value
      assert.ok(
        choices.some((choice) => choice.value === value),
        `Unavailable choice ${value} for ${message}`,
      )
      selections.push({ message, value })
      return value
    },
    async text(message, initial = '', validate) {
      const value = textAnswers.shift() ?? initial
      if (value instanceof Error) throw value
      texts.push({ message, initial })
      assert.equal(validate?.(value), undefined)
      return value
    },
    async confirm() {
      return true
    },
  }
  return { ui, selections, texts }
}

function fixture(options: { checks?: boolean; workspace?: boolean } = {}) {
  const calls: { operation: string; input: unknown }[] = []
  const runtimes = [
    { id: 'missing', label: 'Missing', bin: 'missing', installed: false, enabled: 1 },
    { id: 'disabled', label: 'Disabled', bin: 'disabled', installed: true, enabled: 0 },
    { id: 'claude', label: 'Claude Code', bin: 'claude', installed: true, enabled: 1 },
    { id: 'codex', label: 'Codex CLI', bin: 'codex', installed: true, enabled: 1 },
  ]
  const workspaces =
    options.workspace === false
      ? []
      : [
          {
            id: 'ws',
            projectId: 'p',
            name: 'main',
            branch: 'main',
            path: process.cwd(),
            projectName: 'Example',
          },
        ]
  const client: CliClient = {
    async call(operation, input) {
      calls.push({ operation, input })
      if (operation === 'runtimes.list') return runtimes
      if (operation === 'workspaces.list') return workspaces
      if (operation === 'projects.list')
        return [
          {
            id: 'p',
            path: process.cwd(),
            checks: options.checks === false ? '[]' : '[{"command":"npm test"}]',
          },
        ]
      if (operation === 'projects.update') return {}
      throw new Error(`Unexpected operation: ${operation}`)
    },
  }
  return { client, calls, runtimes }
}

test('Enter twice uses the remembered installed agent and current checkout without starting work during planning', async () => {
  const { client, calls } = fixture()
  const { ui, selections, texts } = terminal()
  const intent = await guideRun(client, ['explain project in 5 words'], 'run', ui)
  assert.equal(intent.runtimeHint, 'codex')
  assert.equal(intent.workspaceHint, 'ws')
  assert.equal(intent.prompt, 'explain project in 5 words')
  assert.deepEqual(intent.schedule, { kind: 'now' })
  assert.deepEqual(
    selections.map((row) => row.value),
    ['codex', 'go'],
  )
  assert.equal(texts.length, 0)
  assert.ok(calls.every((row) => row.operation.endsWith('.list')))
})

test('an explicit agent takes priority, and an unavailable remembered agent falls back to an installed one', async () => {
  const { client } = fixture()
  const explicit = await guideRun(
    client,
    ['--runtime=claude', '--prompt=explain it'],
    'run',
    terminal().ui,
  )
  assert.equal(explicit.runtimeHint, 'claude')
  const fallback = await selectRuntime(client, '', terminal([], [], 'disabled').ui)
  assert.equal(fallback.id, 'claude')
})

test('run can become a one-time schedule with the tomorrow morning default', async () => {
  const { client } = fixture()
  const { ui } = terminal(['codex', 'schedule', 'tomorrow', 'go'])
  const intent = await guideRun(client, ['review this project'], 'run', ui)
  assert.equal(intent.schedule.kind, 'once')
  if (intent.schedule.kind === 'once') {
    assert.ok(intent.schedule.at > Date.now())
    assert.equal(new Date(intent.schedule.at).getHours(), 9)
    assert.equal(intent.schedule.cron, '0 9 * * *')
  }
})

test('weekly and interval choices use the same scheduling parser as explicit commands', async () => {
  const weekly = await chooseSchedule(terminal(['week', 'friday'], ['14:30']).ui)
  assert.deepEqual(weekly, { kind: 'recurring', cron: '30 14 * * 5' })
  const interval = await chooseSchedule(terminal(['interval'], ['6 hours']).ui)
  assert.deepEqual(interval, { kind: 'recurring', cron: '0 */6 * * *' })
})

test('preview does not save project checks; actual schedule setup offers the missing check', async () => {
  const preview = fixture({ checks: false })
  await guideRun(
    preview.client,
    ['every', 'day', 'at', '9', 'review this project'],
    'schedule',
    terminal().ui,
    { dryRun: true },
  )
  assert.ok(preview.calls.every((row) => row.operation.endsWith('.list')))
  const actual = fixture({ checks: false })
  await guideRun(
    actual.client,
    ['every', 'day', 'at', '9', 'review this project'],
    'schedule',
    terminal([], ['npm run typecheck']).ui,
  )
  const update = actual.calls.find((row) => row.operation === 'projects.update')
  assert.deepEqual(update?.input, {
    id: 'p',
    checks: [{ id: 'cli-check-1', name: 'npm run typecheck', command: 'npm run typecheck' }],
  })
})

test('settings edit the model while retaining the literal prompt and explicitly selected workspace', async () => {
  const { client } = fixture()
  const { ui } = terminal(['codex', 'settings', 'model', 'go'], ['my-model'])
  const intent = await guideRun(
    client,
    ['--in=ws', '--prompt=explain what runs every day at 9'],
    'run',
    ui,
  )
  assert.equal(intent.modelHint, 'my-model')
  assert.equal(intent.prompt, 'explain what runs every day at 9')
  assert.equal(intent.openPr, false)
  assert.equal(intent.workspaceHint, 'ws')
  assert.equal(intent.schedule.kind, 'now')
})

test('cancelling a scheduled draft does not change checks or create an automation', async () => {
  const { client, calls } = fixture({ checks: false })
  await assert.rejects(
    guideRun(
      client,
      ['every', 'day', 'at', '9', 'review this project'],
      'schedule',
      terminal(['codex', 'cancel']).ui,
    ),
    Cancelled,
  )
  assert.ok(calls.every((row) => row.operation.endsWith('.list')))
})

test('remote selection requires a choice even when the local cwd matches a server path', async () => {
  const { client } = fixture()
  const { ui, selections } = terminal(['ws'])
  await selectWorkspace(client, '', ui, { remote: true })
  assert.equal(selections.length, 1)
  const unattended = { ...ui, interactive: false }
  await assert.rejects(selectWorkspace(client, '', unattended, { remote: true }), /workspace/)
  await assert.rejects(selectRuntime(client, '', unattended), /Which runtime/)
})

test('a preview outside a registered project offers exit without registering anything', async () => {
  const { client, calls } = fixture({ workspace: false })
  await assert.rejects(
    guideRun(client, ['review this project'], 'run', terminal(['codex', ':exit']).ui, {
      dryRun: true,
    }),
    Cancelled,
  )
  assert.ok(calls.every((row) => row.operation.endsWith('.list')))
})

test('back through run setup keeps the prompt and allows changing the agent without writes', async () => {
  const { client, calls } = fixture()
  const { ui, texts } = terminal(
    [new Back(), 'claude', 'go'],
    ['Review the CLI', 'Review the CLI navigation'],
  )
  const intent = await guideRun(client, [], 'run', ui)
  assert.equal(texts[1]?.initial, 'Review the CLI')
  assert.equal(intent.prompt, 'Review the CLI navigation')
  assert.equal(intent.runtimeHint, 'claude')
  assert.ok(calls.every((row) => row.operation.endsWith('.list')))
})

test('back from a settings field returns to settings and keeps the existing model', async () => {
  const { client } = fixture()
  const { ui } = terminal(['codex', 'settings', 'model', 'back', 'go'], [new Back()])
  const intent = await guideRun(client, ['--model=original', '--prompt=Review it'], 'run', ui)
  assert.equal(intent.modelHint, 'original')
})

test('back from weekly time returns to the day, then schedule selection', async () => {
  const { ui } = terminal(['week', 'friday', new Back(), 'day'], [new Back(), '10:30'])
  assert.deepEqual(await chooseSchedule(ui), { kind: 'recurring', cron: '30 10 * * *' })
})
