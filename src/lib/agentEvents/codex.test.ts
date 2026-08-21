import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseCodexObject } from './codex.ts'

describe('parseCodexObject', () => {
  it('emits the agent message only when the item completes', () => {
    assert.deepEqual(
      parseCodexObject({ type: 'item.started', item: { type: 'agent_message', text: 'partial' } }),
      [],
    )
    assert.deepEqual(
      parseCodexObject({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }),
      [{ kind: 'assistant', payload: { text: 'done' } }],
    )
  })

  it('maps reasoning items to thought events', () => {
    assert.deepEqual(
      parseCodexObject({
        type: 'item.started',
        item: { type: 'reasoning', text: '' },
      }),
      [{ kind: 'thought', payload: { text: '' } }],
    )
    assert.deepEqual(
      parseCodexObject({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'considering the diff' },
      }),
      [{ kind: 'thought', payload: { text: 'considering the diff' } }],
    )
    assert.deepEqual(
      parseCodexObject({
        type: 'item.updated',
        item: { type: 'reasoning', summary: [{ text: 'step one' }] },
      }),
      [{ kind: 'thought', payload: { text: 'step one' } }],
    )
  })

  it('maps command_execution start/completion to an execute tool call', () => {
    const [start] = parseCodexObject({
      type: 'item.started',
      item: { type: 'command_execution', id: 'i1', command: 'pnpm test' },
    })
    assert.equal(start?.kind, 'tool_start')
    assert.equal(start?.payload.toolKind, 'execute')
    assert.equal(start?.payload.status, 'in_progress')
    assert.equal(start?.payload.title, 'command_execution · pnpm test')

    const [done] = parseCodexObject({
      type: 'item.completed',
      item: {
        type: 'command_execution',
        id: 'i1',
        command: 'pnpm test',
        aggregated_output: 'ok',
        exit_code: 0,
      },
    })
    assert.equal(done?.kind, 'tool_result')
    assert.equal(done?.payload.status, 'completed')
    assert.equal(done?.payload.content, 'ok')
  })

  it('marks a non-zero exit as a failed tool call', () => {
    const [done] = parseCodexObject({
      type: 'item.completed',
      item: { type: 'command_execution', id: 'i2', command: 'false', exit_code: 1 },
    })
    assert.equal(done?.payload.status, 'failed')
    assert.deepEqual(done?.payload.rawOutput, { exitCode: 1 })
  })

  it('maps file_change items to an edit call with locations', () => {
    const [done] = parseCodexObject({
      type: 'item.completed',
      item: {
        type: 'file_change',
        id: 'i3',
        status: 'completed',
        changes: [{ path: '/repo/a.ts', kind: 'update' }],
      },
    })
    assert.equal(done?.payload.toolKind, 'edit')
    assert.deepEqual(done?.payload.locations, [{ path: '/repo/a.ts' }])
  })

  it('maps a todo_list item to an ACP plan', () => {
    const [event] = parseCodexObject({
      type: 'item.updated',
      item: {
        type: 'todo_list',
        items: [
          { text: 'Read the failing test', completed: true },
          { text: 'Fix it', status: 'in_progress' },
          { text: 'Ship', completed: false },
        ],
      },
    })
    assert.equal(event?.kind, 'plan')
    assert.deepEqual(
      event?.payload.plan?.map((p) => [p.content, p.status]),
      [
        ['Read the failing test', 'completed'],
        ['Fix it', 'in_progress'],
        ['Ship', 'pending'],
      ],
    )
  })

  it('maps mcp tool calls with callRole mcp', () => {
    const [start] = parseCodexObject({
      type: 'item.started',
      item: {
        type: 'mcp_tool_call',
        id: 'm1',
        server: 'docs',
        tool: 'search_docs',
        arguments: { query: 'acp' },
      },
    })
    assert.equal(start?.payload.name, 'search_docs')
    assert.equal(start?.payload.callRole, 'mcp')
    assert.equal(start?.payload.mcpServer, 'docs')
    assert.equal(start?.payload.title, 'docs · search_docs')
  })

  it('maps turn completion and failure', () => {
    assert.deepEqual(parseCodexObject({ type: 'turn.completed' }), [
      { kind: 'turn_done', payload: { stopReason: 'end_turn' } },
    ])
    const failed = parseCodexObject({ type: 'turn.failed', error: { message: 'ratelimited' } })
    assert.equal(failed[0]?.kind, 'error')
    assert.equal(failed[0]?.payload.message, 'ratelimited')
    assert.deepEqual(failed[1], { kind: 'turn_done', payload: {} })
  })
})
