import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { latestActivity, latestActivityLabel } from './turnActivity.ts'
import type { TurnEventKind, TurnEventPayload } from './turnEvents.ts'

function ev(
  kind: TurnEventKind,
  payload: TurnEventPayload,
): { kind: TurnEventKind; payload: string } {
  return { kind, payload: JSON.stringify(payload) }
}

describe('latestActivity', () => {
  it('defaults to breathing before the agent has spoken', () => {
    assert.deepEqual(latestActivity([]), { orb: 'breathing', verb: 'Starting' })
  })

  it('maps an open approval to listening', () => {
    const events = [ev('approval_request', { requestId: 'r1', name: 'Bash' })]
    assert.equal(latestActivity(events).orb, 'listening')
    assert.equal(latestActivity(events).step, 'approval')
  })

  it('maps an unsettled search tool to searching', () => {
    const events = [
      ev('tool_start', {
        toolCallId: 'c1',
        name: 'Grep',
        toolKind: 'search',
        title: 'Grep · TODO',
        status: 'in_progress',
      }),
    ]
    const activity = latestActivity(events)
    assert.equal(activity.orb, 'searching')
    assert.match(String(activity.step), /TODO/)
    assert.equal(latestActivityLabel(events), activity.step)
  })

  it('maps MCP, sub-agent, and edit calls onto connecting / weaving / shaping', () => {
    assert.equal(
      latestActivity([
        ev('tool_start', { toolCallId: 'm', callRole: 'mcp', toolKind: 'other', name: 'list' }),
      ]).orb,
      'connecting',
    )
    assert.equal(
      latestActivity([
        ev('tool_start', {
          toolCallId: 's',
          callRole: 'subagent',
          toolKind: 'think',
          name: 'Task',
        }),
      ]).orb,
      'weaving',
    )
    assert.equal(
      latestActivity([
        ev('tool_start', { toolCallId: 'e', toolKind: 'edit', name: 'Edit', title: 'Edit · a.ts' }),
      ]).orb,
      'shaping',
    )
  })

  it('maps a thought to solving and streaming prose to composing', () => {
    assert.equal(latestActivity([ev('thought', { text: 'weighing' })]).orb, 'solving')
    assert.equal(latestActivity([ev('thought', {})]).verb, 'Thinking')
    assert.equal(latestActivity([ev('assistant', { text: 'Here is' })]).orb, 'composing')
  })

  it('prefers an open tool over an earlier thought', () => {
    const events = [
      ev('thought', { text: 'hmm' }),
      ev('tool_start', { toolCallId: 'c', toolKind: 'execute', name: 'Bash' }),
    ]
    assert.equal(latestActivity(events).orb, 'working')
  })

  it('ignores a settled tool and falls back to the last thought', () => {
    const events = [
      ev('tool_start', { toolCallId: 'c', toolKind: 'read', name: 'Read' }),
      ev('tool_result', { toolCallId: 'c', status: 'completed' }),
      ev('thought', { text: 'ok' }),
    ]
    assert.equal(latestActivity(events).orb, 'solving')
  })
})
