import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ParsedTurnEvent } from './agentEvents/types.ts'
import {
  MAX_IMPORT_EVENTS,
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

  it('does not allow one oversized turn to exceed the event cap', () => {
    const turns: TranscriptTurn[] = [
      {
        prompt: 'old',
        promptAt: 1,
        events: Array.from({ length: 3 }, (_, i) => event(`old-${i}`)),
        usage: null,
        endedAt: 2,
      },
      {
        prompt: 'new',
        promptAt: 3,
        events: Array.from({ length: MAX_IMPORT_EVENTS + 1 }, (_, i) => event(`new-${i}`)),
        usage: null,
        endedAt: 4,
      },
    ]

    const trimmed = trimTranscript(turns)
    assert.equal(trimmed.turns.length, 1)
    assert.equal(trimmed.turns[0]?.prompt, 'new')
    assert.equal(trimmed.turns[0]?.events.length, MAX_IMPORT_EVENTS)
    assert.equal(trimmed.dropped, 1)

    const small = trimTranscript(turns, { maxTurns: 1, maxEvents: 2 })
    assert.equal(small.turns.length, 1)
    assert.equal(small.turns[0]?.events.length, 2)
    assert.equal(small.turns[0]?.events[0]?.payload.text, `new-${MAX_IMPORT_EVENTS - 1}`)
    assert.equal(small.turns[0]?.events[1]?.payload.text, `new-${MAX_IMPORT_EVENTS}`)
  })
})
