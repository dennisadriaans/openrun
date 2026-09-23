import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAcpSessionUpdate } from './acp.ts'

describe('parseAcpSessionUpdate', () => {
  it('maps message and thought chunks', () => {
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello' },
      }),
      [{ kind: 'assistant', payload: { text: 'Hello' } }],
    )
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'hmm' },
      }),
      [{ kind: 'thought', payload: { text: 'hmm' } }],
    )
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: '' },
      }),
      [{ kind: 'thought', payload: { text: '' } }],
    )
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'do it' },
      }),
      [{ kind: 'user', payload: { text: 'do it' } }],
    )
  })

  it('ignores non-text content blocks rather than dumping JSON', () => {
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', data: 'base64…', mimeType: 'image/png' },
      }),
      [],
    )
  })

  it('carries the protocol tool fields straight through', () => {
    const [event] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'call_1',
      title: 'Read src/index.ts',
      toolName: 'read_file',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: 'src/index.ts' },
      locations: [{ path: '/repo/src/index.ts', line: 4 }],
    })
    assert.equal(event?.kind, 'tool_start')
    assert.equal(event?.payload.toolCallId, 'call_1')
    assert.equal(event?.payload.title, 'Read src/index.ts')
    assert.equal(event?.payload.toolKind, 'read')
    assert.equal(event?.payload.callRole, 'tool')
    assert.equal(event?.payload.status, 'in_progress')
    assert.deepEqual(event?.payload.locations, [{ path: '/repo/src/index.ts', line: 4 }])
  })

  it('classifies an MCP-named ACP tool call', () => {
    const [event] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'm1',
      toolName: 'mcp__cursor-cloud__run-info',
      title: 'run info',
      status: 'in_progress',
    })
    assert.equal(event?.payload.callRole, 'mcp')
    assert.equal(event?.payload.mcpServer, 'cursor-cloud')
    assert.equal(event?.payload.title, 'run info')
  })

  it('classifies web browse tools as fetch even when the agent says search', () => {
    const [event] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'w1',
      title: 'Search the web',
      toolName: 'web_search',
      kind: 'search',
      status: 'in_progress',
      rawInput: { query: 'openrun' },
    })
    assert.equal(event?.payload.toolKind, 'fetch')
  })

  it('falls back to an inferred kind when the agent omits one', () => {
    const [event] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c',
      title: 'run the suite',
      toolName: 'bash',
    })
    assert.equal(event?.payload.toolKind, 'execute')
    assert.equal(event?.payload.status, 'pending')
  })

  it('only emits a tool_result once the call settles', () => {
    assert.deepEqual(
      parseAcpSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'c',
        status: 'in_progress',
      }),
      [],
    )
    const [done] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c',
      status: 'failed',
      content: [{ type: 'content', content: { type: 'text', text: 'no such file' } }],
    })
    assert.equal(done?.kind, 'tool_result')
    assert.equal(done?.payload.status, 'failed')
    assert.equal(done?.payload.content, 'no such file')
  })

  it('renders diff content as a readable patch', () => {
    const [done] = parseAcpSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c',
      status: 'completed',
      content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'a', newText: 'b' }],
    })
    assert.match(String(done?.payload.content), /--- \/repo\/a\.ts/)
    assert.match(String(done?.payload.content), /b/)
  })

  it('maps plan updates', () => {
    const [event] = parseAcpSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Investigate', priority: 'high', status: 'in_progress' },
        { content: 'Fix', priority: 'medium', status: 'pending' },
      ],
    })
    assert.equal(event?.kind, 'plan')
    assert.equal(event?.payload.plan?.length, 2)
    assert.equal(event?.payload.plan?.[0]?.status, 'in_progress')
  })

  it('drops session metadata updates', () => {
    assert.deepEqual(parseAcpSessionUpdate({ sessionUpdate: 'available_commands_update' }), [])
    assert.deepEqual(parseAcpSessionUpdate({ sessionUpdate: 'current_mode_update' }), [])
    assert.deepEqual(parseAcpSessionUpdate({ sessionUpdate: 'usage_update' }), [])
  })
})
