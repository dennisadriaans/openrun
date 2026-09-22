import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  Back,
  browse,
  CliUi,
  CommandRequest,
  isCommandRequest,
  Quit,
  RequestInput,
  steps,
} from './ui.ts'

function uiWithTerminal(terminal: object) {
  const ui = new CliUi(true)
  const remembered: string[] = []
  Reflect.set(ui, 'terminal', terminal)
  Reflect.set(ui, 'commandHistory', {
    commands: remembered,
    remember: (command: string) => remembered.push(command),
  })
  return { ui, remembered }
}

test('complete task requests and navigation work in fields without claiming ordinary values', () => {
  for (const request of [
    "create new file test-html with contents '123' do it in 10 seconds sonnet low",
    'fix the failing checkout test',
    'could you please fix the failing checkout test using sonnet low',
    'sonnet low',
    'sol medium create a new file',
    'in 10 seconds create a file using sonnet low',
    'show recent runs',
    'runs',
    'schedule in 10 seconds "create a file" using sonnet low',
    'openrun worker status',
  ])
    assert.equal(isCommandRequest(request), true, request)
  for (const value of [
    '/repo/example',
    './test',
    'test',
    'low',
    'sonnet',
    'claude',
    'gpt-5.6-sol',
    'in 10 seconds',
    '0 9 * * 1-5',
    'pnpm test',
    '{"prompt":"create a file"}',
    'https://example.com',
  ])
    assert.equal(isCommandRequest(value), false, value)
})

test('a request from a nested menu leaves the old flow before any later action', async () => {
  const request = 'create a file do it in 10 seconds sonnet low'
  const { ui, remembered } = uiWithTerminal({
    async select() {
      throw new RequestInput('c', 'current')
    },
    async homeRequest(_history: unknown, initial: string) {
      assert.equal(initial, 'c')
      return request
    },
  })
  let writes = 0
  await assert.rejects(
    steps([
      async () => {
        await browse(
          () => ui.select('Choose', [{ value: 'current', label: 'Current' }]),
          async () => {
            writes++
          },
        )
      },
      async () => {
        writes++
      },
    ]),
    (error) => error instanceof CommandRequest && error.request === request,
  )
  assert.equal(writes, 0)
  assert.deepEqual(remembered, [request])
})

test('Escape from a request restores the field draft instead of abandoning setup', async () => {
  let visits = 0
  const { ui, remembered } = uiWithTerminal({
    async text(_message: string, initial: string) {
      if (++visits === 1) throw new RequestInput('', '/repo/edited')
      assert.equal(initial, '/repo/edited')
      return initial
    },
    async homeRequest() {
      throw new Back()
    },
  })
  assert.equal(await ui.text('Repository path', '/repo/original'), '/repo/edited')
  assert.equal(visits, 2)
  assert.deepEqual(remembered, [])
})

test('Escape from a request restores the selected menu item', async () => {
  let visits = 0
  const { ui } = uiWithTerminal({
    async select(_message: string, _choices: unknown, initial: string) {
      if (++visits === 1) throw new RequestInput('ask', 'second')
      assert.equal(initial, 'second')
      return initial
    },
    async homeRequest() {
      throw new Back()
    },
  })
  assert.equal(
    await ui.select('Choose', [
      { value: 'first', label: 'First' },
      { value: 'second', label: 'Second' },
    ]),
    'second',
  )
})

test('a request typed into a field is remembered once and escapes validation flows', async () => {
  const request = 'review changes sonnet low'
  const { ui, remembered } = uiWithTerminal({
    async text() {
      throw new CommandRequest(request)
    },
  })
  await assert.rejects(
    ui.text('When should it run?'),
    (error) => error instanceof CommandRequest && error.request === request,
  )
  assert.deepEqual(remembered, [request])
})

test('the output screen accepts a new request without going back to Home', async () => {
  const { ui, remembered } = uiWithTerminal({
    hasUnreadOutput: true,
    async select() {
      throw new RequestInput('r', 'home')
    },
    async homeRequest() {
      return 'runs'
    },
  })
  await assert.rejects(
    ui.presentOutput(),
    (error) => error instanceof CommandRequest && error.request === 'runs',
  )
  assert.deepEqual(remembered, ['runs'])
})

test('a request submitted while leaving a menu is dispatched without needing Enter again', async () => {
  const request = new RequestInput('runs', 'home')
  request.submitted = true
  const { ui, remembered } = uiWithTerminal({
    async select() {
      throw request
    },
    async homeRequest() {
      assert.fail('The request was already submitted')
    },
  })
  await assert.rejects(
    ui.select('Choose', [{ value: 'home', label: 'Home' }]),
    (error) => error instanceof CommandRequest && error.request === 'runs',
  )
  assert.deepEqual(remembered, ['runs'])
})

test('nested menus return to the parent and never replay a failed action', async () => {
  const choices = ['detail', 'write', ':exit']
  const visits: string[] = []
  const failure = new Error('Response lost; the write may have completed')
  await assert.rejects(
    browse(
      async () => choices.shift()!,
      async (choice) => {
        visits.push(choice)
        if (choice === 'detail') throw new Back()
        throw failure
      },
    ),
    (error) => error === failure,
  )
  assert.deepEqual(visits, ['detail', 'write'])
  assert.deepEqual(choices, [':exit'])
})

test('quitting escapes all setup steps without replaying them', async () => {
  const visited: string[] = []
  await assert.rejects(
    steps([
      async () => {
        visited.push('prompt')
      },
      async () => {
        visited.push('agent')
        throw new Quit()
      },
      async () => {
        visited.push('submit')
      },
    ]),
    Quit,
  )
  assert.deepEqual(visited, ['prompt', 'agent'])
})
