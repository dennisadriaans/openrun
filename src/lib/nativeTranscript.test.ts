import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ParsedTurnEvent } from './agentEvents/types.ts'
import {
  MAX_IMPORT_EVENTS,
  omittedTurnsNote,
  parseAntigravityTranscript,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseGrokTranscript,
  trimTranscript,
  type TranscriptTurn,
} from './nativeTranscript.ts'

function event(text: string): ParsedTurnEvent {
  return { kind: 'assistant', payload: { text } }
}

describe('parseClaudeTranscript', () => {
  it('skips malformed lines and pairs tool use/results inside a turn', () => {
    const turns = parseClaudeTranscript(
      [
        'not json',
        JSON.stringify({
          type: 'user',
          timestamp: '2026-08-29T10:00:00.000Z',
          message: { content: 'Fix the parser' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-08-29T10:00:01.000Z',
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } },
              { type: 'text', text: 'I found it.' },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2026-08-29T10:00:02.000Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
        }),
      ].join('\n'),
    )

    assert.equal(turns.length, 1)
    assert.equal(turns[0]?.prompt, 'Fix the parser')
    assert.deepEqual(
      turns[0]?.events.map((item) => item.kind),
      ['tool_start', 'assistant', 'tool_result', 'turn_done'],
    )
    assert.equal(turns[0]?.events[0]?.payload.toolCallId, 'tool-1')
    assert.equal(turns[0]?.events[2]?.payload.toolCallId, 'tool-1')
    assert.equal(turns[0]?.events[2]?.payload.status, 'completed')
  })

  it('filters sidechains and tolerates absent or invalid fields', () => {
    const turns = parseClaudeTranscript(
      [
        JSON.stringify({
          type: 'user',
          isSidechain: true,
          message: { content: 'Do not import this' },
        }),
        JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: 'nope' } }),
        JSON.stringify({ type: 'user', timestamp: 'not a date', message: { content: 42 } }),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'unknown' }] } }),
        JSON.stringify({ type: 'user', message: { content: 'Keep this' } }),
        JSON.stringify({ type: 'assistant', message: { content: 'Done' } }),
      ].join('\n'),
    )

    assert.equal(turns.length, 1)
    assert.equal(turns[0]?.prompt, 'Keep this')
    assert.equal(turns[0]?.events[0]?.kind, 'assistant')
  })

  it('omits an oversized turn instead of orphaning its tool events', () => {
    const turns: TranscriptTurn[] = [
      {
        prompt: 'old',
        promptAt: 1,
        events: [event('old')],
        endedAt: 2,
      },
      {
        prompt: 'new',
        promptAt: 3,
        events: [
          {
            kind: 'tool_start',
            payload: { toolCallId: 'tool-1', name: 'Read', status: 'in_progress' },
          },
          {
            kind: 'tool_result',
            payload: { toolCallId: 'tool-1', status: 'completed', content: 'ok' },
          },
          { kind: 'turn_done', payload: { stopReason: 'end_turn' } },
          event('more history'),
        ],
        endedAt: 4,
      },
    ]

    const trimmed = trimTranscript(turns, { maxEvents: 3 })
    assert.equal(trimmed.turns.length, 0)
    assert.equal(trimmed.dropped, 2)
    assert.equal(trimmed.droppedEvents, 5)
    assert.match(
      omittedTurnsNote(trimmed.dropped, trimmed.droppedEvents),
      /2 earlier turns and 5 events/,
    )
    assert.ok(trimmed.turns.every((turn) => turn.events.length <= 3))

    const small = trimTranscript(turns, { maxTurns: 1, maxEvents: MAX_IMPORT_EVENTS })
    assert.equal(small.turns.length, 1)
    assert.equal(small.turns[0]?.prompt, 'new')
    assert.equal(small.dropped, 1)
    assert.equal(small.droppedEvents, 1)
  })
})

describe('parseCodexTranscript', () => {
  it('imports user, assistant, and tool history from rollout JSONL', () => {
    const turns = parseCodexTranscript(
      [
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-08-30T10:00:00.000Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Help' }],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-08-30T10:00:01.000Z',
          payload: {
            type: 'custom_tool_call',
            call_id: 'call-1',
            name: 'exec',
            input: '{"cmd":"pwd"}',
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-08-30T10:00:02.000Z',
          payload: { type: 'custom_tool_call_output', call_id: 'call-1', output: 'ok' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-08-30T10:00:03.000Z',
          payload: {
            type: 'token_count',
            info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-08-30T10:00:04.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Done' }],
          },
        }),
      ].join('\n'),
    )

    assert.equal(turns.length, 1)
    assert.equal(turns[0]?.prompt, 'Help')
    assert.deepEqual(
      turns[0]?.events.map((item) => item.kind),
      ['tool_start', 'tool_result', 'assistant', 'turn_done'],
    )
  })

  it('skips Codex environment bootstrap messages', () => {
    const turns = parseCodexTranscript(
      [
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '<environment_context>hidden</environment_context>' },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Visible' }],
          },
        }),
      ].join('\n'),
    )
    assert.deepEqual(
      turns.map((turn) => turn.prompt),
      ['Visible'],
    )
  })
})

describe('parseGrokTranscript', () => {
  it('imports prose and tool calls while skipping synthetic user context', () => {
    const turns = parseGrokTranscript(
      [
        JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'Real prompt' }] }),
        JSON.stringify({
          type: 'user',
          synthetic_reason: 'tool',
          content: [{ type: 'text', text: 'hidden' }],
        }),
        JSON.stringify({
          type: 'assistant',
          content: 'Working',
          tool_calls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' }],
        }),
        JSON.stringify({ type: 'tool_result', tool_call_id: 'call-1', content: 'contents' }),
        JSON.stringify({ type: 'assistant', content: 'Done' }),
      ].join('\n'),
    )
    assert.equal(turns.length, 1)
    assert.equal(turns[0]?.prompt, 'Real prompt')
    assert.deepEqual(
      turns[0]?.events.map((item) => item.kind),
      ['assistant', 'tool_start', 'tool_result', 'assistant', 'turn_done'],
    )
  })
})

describe('parseAntigravityTranscript', () => {
  it('imports rendered user, tool, and assistant steps', () => {
    const turns = parseAntigravityTranscript(
      [
        JSON.stringify({
          type: 'USER_INPUT',
          source: 'USER_EXPLICIT',
          created_at: '2026-08-30T10:00:00.000Z',
          content: 'Inspect this',
        }),
        JSON.stringify({
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-08-30T10:00:01.000Z',
          tool_calls: [{ name: 'view_file', args: { path: 'a.ts' } }],
        }),
        JSON.stringify({
          type: 'GENERIC',
          source: 'MODEL',
          created_at: '2026-08-30T10:00:02.000Z',
          content: 'file contents',
        }),
        JSON.stringify({
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          created_at: '2026-08-30T10:00:03.000Z',
          content: 'Finished',
        }),
      ].join('\n'),
    )
    assert.equal(turns[0]?.prompt, 'Inspect this')
    assert.deepEqual(
      turns[0]?.events.map((item) => item.kind),
      ['tool_start', 'tool_result', 'assistant', 'turn_done'],
    )
  })
})
