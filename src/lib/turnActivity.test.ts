import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { TurnEventKind } from './turnEvents.ts'
import { latestActivityLabel } from './turnActivity.ts'

const event = (kind: TurnEventKind, payload: unknown) => ({
  kind,
  payload: JSON.stringify(payload),
})

test('an in-flight tool call is described by verb and detail', () => {
  const label = latestActivityLabel([
    event('assistant', { text: 'On it.' }),
    event('tool_start', {
      toolCallId: 'a',
      name: 'Bash',
      toolKind: 'execute',
      title: 'Bash · pnpm test',
    }),
  ])
  assert.equal(label, 'Running pnpm test')
})

test('a settled call is skipped in favour of the one still open', () => {
  const label = latestActivityLabel([
    event('tool_start', { toolCallId: 'a', name: 'Read', toolKind: 'read', title: 'Read · a.ts' }),
    event('tool_start', { toolCallId: 'b', name: 'Edit', toolKind: 'edit', title: 'Edit · b.ts' }),
    event('tool_result', { toolCallId: 'b' }),
  ])
  assert.equal(label, 'Reading a.ts')
})

test('with no open call the agent’s last words are the label', () => {
  const label = latestActivityLabel([
    event('tool_start', { toolCallId: 'a', name: 'Read', title: 'Read · a.ts' }),
    event('tool_result', { toolCallId: 'a' }),
    event('thought', { text: 'Checking the gate module\nsecond line' }),
  ])
  assert.equal(label, 'Checking the gate module')
})

test('an empty or unparsable transcript has no label', () => {
  assert.equal(latestActivityLabel([]), undefined)
  const unparsable: { kind: TurnEventKind; payload: string } = { kind: 'assistant', payload: '{' }
  assert.equal(latestActivityLabel([unparsable]), undefined)
})

test('a long line is truncated', () => {
  const label = latestActivityLabel([event('assistant', { text: 'x'.repeat(200) })])
  assert.equal(label?.length, 80)
  assert.ok(label?.endsWith('…'))
})
