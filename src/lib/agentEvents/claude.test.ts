import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseClaudeObject } from './claude.ts'

describe('parseClaudeObject', () => {
  it('maps text blocks to assistant and thinking blocks to thought', () => {
    const events = parseClaudeObject({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'weighing options' },
          { type: 'text', text: 'Done.' },
        ],
      },
    })
    assert.deepEqual(events, [
      { kind: 'thought', payload: { text: 'weighing options' } },
      { kind: 'assistant', payload: { text: 'Done.' } },
    ])
  })

  it('maps tool_use to an in_progress tool_start with an inferred kind', () => {
    const [event] = parseClaudeObject({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'pnpm test' } },
        ],
      },
    })
    assert.equal(event?.kind, 'tool_start')
    assert.equal(event?.payload.toolCallId, 'toolu_1')
    assert.equal(event?.payload.name, 'Bash')
    assert.equal(event?.payload.toolKind, 'execute')
    assert.equal(event?.payload.callRole, 'tool')
    assert.equal(event?.payload.status, 'in_progress')
    assert.equal(event?.payload.title, 'Bash · pnpm test')
  })

  it('tags MCP, Skill, and Task tool_use with distinct call roles', () => {
    const events = parseClaudeObject({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'm1',
            name: 'mcp__github__list_prs',
            input: { state: 'open' },
          },
          {
            type: 'tool_use',
            id: 's1',
            name: 'Skill',
            input: { skill: 'figma-use' },
          },
          {
            type: 'tool_use',
            id: 't1',
            name: 'Task',
            input: { description: 'Explore gates', subagent_type: 'explore' },
          },
        ],
      },
    })
    assert.equal(events[0]?.payload.callRole, 'mcp')
    assert.equal(events[0]?.payload.mcpServer, 'github')
    assert.equal(events[0]?.payload.title, 'github · list_prs')
    assert.equal(events[1]?.payload.callRole, 'skill')
    assert.equal(events[1]?.payload.title, 'figma-use')
    assert.equal(events[2]?.payload.callRole, 'subagent')
    assert.equal(events[2]?.payload.title, 'explore · Explore gates')
  })

  it('derives ACP locations from a file tool input', () => {
    const [event] = parseClaudeObject({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't', name: 'Edit', input: { file_path: '/repo/a.ts' } }],
      },
    })
    assert.equal(event?.payload.toolKind, 'edit')
    assert.deepEqual(event?.payload.locations, [{ path: '/repo/a.ts' }])
  })

  it('settles a tool call from the matching tool_result', () => {
    const [ok] = parseClaudeObject({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'all good' }],
      },
    })
    assert.equal(ok?.kind, 'tool_result')
    assert.equal(ok?.payload.status, 'completed')
    assert.equal(ok?.payload.content, 'all good')

    const [failed] = parseClaudeObject({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'boom' }],
      },
    })
    assert.equal(failed?.payload.status, 'failed')
  })

  it('turns a can_use_tool control request into an approval with ACP options', () => {
    const [event] = parseClaudeObject({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'rm -rf build' },
      },
    })
    assert.equal(event?.kind, 'approval_request')
    assert.equal(event?.payload.requestId, 'req-1')
    assert.equal(event?.payload.name, 'Bash')
    assert.equal(event?.payload.toolKind, 'execute')
    assert.deepEqual(
      event?.payload.options?.map((o) => o.kind),
      ['allow_once', 'reject_once'],
    )
  })

  it('emits turn_done with a stop reason, and an error for is_error results', () => {
    assert.deepEqual(parseClaudeObject({ type: 'result', result: 'shipped' }), [
      { kind: 'turn_done', payload: { result: 'shipped', stopReason: 'end_turn' } },
    ])

    const events = parseClaudeObject({ type: 'result', is_error: true, error: 'nope' })
    assert.equal(events[0]?.kind, 'error')
    assert.equal(events[0]?.payload.message, 'nope')
    assert.equal(events[1]?.kind, 'turn_done')
  })

  it('maps a max-turns result to the ACP stop reason', () => {
    const [done] = parseClaudeObject({ type: 'result', subtype: 'error_max_turns' })
    assert.equal(done?.payload.stopReason, 'max_turn_requests')
  })

  it('tags an MCP approval request with callRole mcp', () => {
    const [event] = parseClaudeObject({
      type: 'control_request',
      request_id: 'req-mcp',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'mcp__linear__create_issue',
        input: { title: 'Ship' },
      },
    })
    assert.equal(event?.payload.callRole, 'mcp')
    assert.equal(event?.payload.mcpServer, 'linear')
  })

  it('ignores envelopes it does not model', () => {
    assert.deepEqual(parseClaudeObject({ type: 'system', subtype: 'init' }), [])
  })
})
