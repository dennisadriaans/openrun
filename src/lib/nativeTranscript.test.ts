import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ParsedTurnEvent } from './agentEvents/types.ts'
import {
  MAX_IMPORT_EVENTS,
  omittedTurnsNote,
  parseClaudeTranscript,
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
        usage: null,
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
        usage: null,
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
