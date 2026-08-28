import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runActivitySummary, runListTitle } from './runPreview.ts'
import type { TurnEventKind, TurnEventPayload, TurnEventRow } from './turnEvents.ts'

function ev(
  kind: TurnEventKind,
  payload: TurnEventPayload,
): Pick<TurnEventRow, 'kind' | 'payload'> {
  return { kind, payload: JSON.stringify(payload) }
}

describe('runListTitle', () => {
  it('uses the first prompt line for a chat run', () => {
    assert.equal(
      runListTitle({
        trigger: 'chat',
        taskName: 'Chat · main',
        prompt: 'Startup issue investigation\n\nLook at the boot logs.',
      }),
      'Startup issue investigation',
    )
  })

  it('falls back to taskName when the chat has no prompt yet', () => {
    assert.equal(
      runListTitle({ trigger: 'chat', taskName: 'Chat · main', prompt: '  ' }),
      'Chat · main',
    )
  })

  it('keeps the automation name rather than the stored prompt', () => {
    assert.equal(
      runListTitle({
        trigger: 'schedule',
        taskName: 'Nightly tests',
        prompt: 'Run the suite and fix whatever failed.',
      }),
      'Nightly tests',
    )
  })
})

describe('runActivitySummary', () => {
  it('names the in-flight tool while the run is live', () => {
    const events = [
      ev('tool_start', {
        name: 'Read',
        toolKind: 'read',
        title: 'Read · terminal 28',
        toolCallId: '1',
      }),
    ]
    assert.equal(runActivitySummary(events, { running: true }), 'Reading terminal 28')
  })

  it('lists edited files once the run has finished', () => {
    const events = [
      ev('tool_start', {
        name: 'Edit',
        toolKind: 'edit',
        title: 'Edit · src/dashboard.ts',
        input: { file_path: 'src/dashboard.ts' },
        toolCallId: '1',
      }),
      ev('tool_result', { toolCallId: '1' }),
      ev('tool_start', {
        name: 'Write',
        toolKind: 'edit',
        title: 'Write · src/require-resource.ts',
        input: { file_path: 'src/require-resource.ts' },
        toolCallId: '2',
      }),
      ev('tool_result', { toolCallId: '2' }),
    ]
    assert.equal(
      runActivitySummary(events, { running: false }),
      'Edited dashboard.ts, require-resource.ts',
    )
  })

  it('falls back to the last tool when nothing was edited', () => {
    const events = [
      ev('tool_start', {
        name: 'Bash',
        toolKind: 'execute',
        title: 'Bash · pnpm test',
        input: { command: 'pnpm test' },
        toolCallId: '1',
      }),
      ev('tool_result', { toolCallId: '1' }),
    ]
    assert.equal(runActivitySummary(events, { running: false }), 'Ran pnpm test')
  })

  it('returns nothing when a finished run never called a tool', () => {
    assert.equal(runActivitySummary([], { running: false }), undefined)
  })
})
