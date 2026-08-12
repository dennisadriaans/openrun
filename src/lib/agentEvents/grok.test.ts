import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AssistantDeltaCoalescer } from './types.ts'
import {
  extractGrokAssistantText,
  parseGrokObject,
  parseGrokStdoutLine,
} from './grok.ts'

describe('parseGrokObject', () => {
  it('maps text data deltas to assistant events', () => {
    assert.deepEqual(parseGrokObject({ type: 'text', data: 'P' }), [
      { kind: 'assistant', payload: { text: 'P' } },
    ])
    assert.deepEqual(parseGrokObject({ type: 'text', data: 'ONG' }), [
      { kind: 'assistant', payload: { text: 'ONG' } },
    ])
  })

  it('maps thought deltas to thought events (ACP agent_thought_chunk)', () => {
    assert.deepEqual(parseGrokObject({ type: 'thought', data: 'The' }), [
      { kind: 'thought', payload: { text: 'The' } },
    ])
  })

  it('drops usage / available_commands noise instead of raw JSON', () => {
    assert.deepEqual(parseGrokObject({ type: 'usage', usage: { input_tokens: 1 } }), [])
    assert.deepEqual(
      parseGrokObject({
        type: 'available_commands',
        tools: ['read_file'],
        commands: ['compact'],
      }),
      [],
    )
  })

  it('maps tool_call with ACP kind / status / title', () => {
    const [event] = parseGrokObject({
      type: 'tool_call',
      toolCallId: 'call-1',
      title: 'list_dir',
      toolName: 'list_dir',
      status: 'pending',
      kind: 'search',
      rawInput: { target_directory: '.' },
    })
    assert.equal(event?.kind, 'tool_start')
    assert.equal(event?.payload.toolCallId, 'call-1')
    assert.equal(event?.payload.name, 'list_dir')
    assert.equal(event?.payload.title, 'list_dir')
    assert.equal(event?.payload.toolKind, 'search')
    assert.equal(event?.payload.status, 'pending')
    assert.deepEqual(event?.payload.input, { target_directory: '.' })
  })

  it('infers a tool kind when the agent sends none', () => {
    const [event] = parseGrokObject({
      type: 'tool_call',
      toolCallId: 'c',
      toolName: 'bash',
      rawInput: { command: 'ls' },
    })
    assert.equal(event?.payload.toolKind, 'execute')
    assert.equal(event?.payload.status, 'in_progress')
  })

  it('carries ACP locations through', () => {
    const [event] = parseGrokObject({
      type: 'tool_call',
      toolCallId: 'c',
      toolName: 'edit',
      locations: [{ path: '/repo/src/a.ts', line: 12 }, { bogus: true }],
    })
    assert.deepEqual(event?.payload.locations, [{ path: '/repo/src/a.ts', line: 12 }])
  })

  it('ignores in-flight tool_call_update pings', () => {
    assert.deepEqual(
      parseGrokObject({
        type: 'tool_call_update',
        toolCallId: 'call-1',
        status: null,
        content: [],
        rawOutput: null,
      }),
      [],
    )
    assert.deepEqual(
      parseGrokObject({ type: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress' }),
      [],
    )
  })

  it('maps a settled tool_call_update to a tool_result with its status', () => {
    const [done] = parseGrokObject({
      type: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      rawOutput: { type: 'ListDir', Content: { content: '- /tmp/\n' } },
    })
    assert.equal(done?.kind, 'tool_result')
    assert.equal(done?.payload.toolCallId, 'call-1')
    assert.equal(done?.payload.status, 'completed')
    assert.equal(done?.payload.content, '- /tmp/\n')

    const [failed] = parseGrokObject({
      type: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'failed',
      rawOutput: 'permission denied',
    })
    assert.equal(failed?.payload.status, 'failed')
    assert.equal(failed?.payload.content, 'permission denied')
  })

  it('maps end to turn_done and error to error', () => {
    assert.deepEqual(parseGrokObject({ type: 'end', stopReason: 'end_turn', sessionId: 'abc' }), [
      { kind: 'turn_done', payload: { result: '', stopReason: 'end_turn' } },
    ])
    assert.deepEqual(parseGrokObject({ type: 'error', message: 'boom' }), [
      { kind: 'error', payload: { message: 'boom' } },
    ])
  })

  it('maps a plan into ACP plan entries', () => {
    assert.deepEqual(parseGrokObject({ type: 'plan', entries: [] }), [])
    assert.deepEqual(
      parseGrokObject({
        type: 'plan',
        entries: [
          { content: 'Read the code', status: 'completed', priority: 'high' },
          { content: 'Write the fix' },
        ],
      }),
      [
        {
          kind: 'plan',
          payload: {
            plan: [
              { content: 'Read the code', status: 'completed', priority: 'high' },
              { content: 'Write the fix', status: 'pending', priority: 'medium' },
            ],
          },
        },
      ],
    )
  })
})

describe('parseGrokStdoutLine', () => {
  it('maps pretty-printed JSON lines to assistant instead of raw pills', () => {
    const lines = ['[', '{', '"name": "stale-open-pr-scan",', '}', ']']
    const coalescer = new AssistantDeltaCoalescer()
    const parsed = lines.flatMap((line) => parseGrokStdoutLine(line))
    assert.ok(parsed.every((e) => e.kind === 'assistant'))
    const flushed = [...coalescer.push(parsed), ...coalescer.flush()]
    assert.equal(flushed.length, 1)
    assert.equal(flushed[0]!.kind, 'assistant')
    assert.match(String(flushed[0]!.payload.text), /stale-open-pr-scan/)
  })

  it('still maps streaming-json text deltas to assistant', () => {
    assert.deepEqual(parseGrokStdoutLine('{"type":"text","data":"Hi"}'), [
      { kind: 'assistant', payload: { text: 'Hi' } },
    ])
  })
})

describe('extractGrokAssistantText', () => {
  it('concatenates text data deltas without JSON walls', () => {
    const stdout = [
      '{"type":"available_commands","tools":[]}',
      '{"type":"thought","data":"hmm"}',
      '{"type":"text","data":"P"}',
      '{"type":"text","data":"ONG"}',
      '{"type":"end","stopReason":"end_turn"}',
    ].join('\n')
    assert.equal(extractGrokAssistantText(stdout), 'PONG')
  })

  it('returns empty string for Grok noise-only streams', () => {
    const stdout = ['{"type":"thought","data":"x"}', '{"type":"usage","usage":{}}'].join('\n')
    assert.equal(extractGrokAssistantText(stdout), '')
  })

  it('returns null for non-Grok stdout', () => {
    assert.equal(extractGrokAssistantText('hello'), null)
    assert.equal(
      extractGrokAssistantText('{"type":"result","result":"ok"}'),
      null,
    )
  })
})
