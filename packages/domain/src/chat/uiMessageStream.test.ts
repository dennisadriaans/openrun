import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'
import {
  encodeUiSseFrame,
  runToUiChunks,
  turnEventToUiChunks,
  UI_MESSAGE_STREAM_HEADERS,
} from './uiMessageStream.ts'

function row(kind: string, payload: TurnEventPayload, id = 'ev1'): TurnEventRow {
  return {
    id,
    messageId: 'msg1',
    runId: 'run1',
    seq: 1,
    kind: kind as TurnEventRow['kind'],
    payload: JSON.stringify(payload),
    createdAt: 0,
  }
}

describe('turnEventToUiChunks', () => {
  it('emits a start/delta/end triple for assistant text', () => {
    assert.deepEqual(turnEventToUiChunks(row('assistant', { text: 'Hi' })), [
      { type: 'text-start', id: 'ev1' },
      { type: 'text-delta', id: 'ev1', delta: 'Hi' },
      { type: 'text-end', id: 'ev1' },
    ])
  })

  it('maps thoughts onto reasoning parts', () => {
    const chunks = turnEventToUiChunks(row('thought', { text: 'hmm' }))
    assert.deepEqual(
      chunks.map((c) => c.type),
      ['reasoning-start', 'reasoning-delta', 'reasoning-end'],
    )
  })

  it('still emits a reasoning span for an empty thought', () => {
    const chunks = turnEventToUiChunks(row('thought', {}))
    assert.deepEqual(
      chunks.map((c) => c.type),
      ['reasoning-start', 'reasoning-end'],
    )
  })

  it('maps a tool call to a dynamic tool input part', () => {
    const [chunk] = turnEventToUiChunks(
      row('tool_start', {
        toolCallId: 'call1',
        name: 'Bash',
        title: 'Bash · ls',
        input: { command: 'ls' },
      }),
    )
    assert.deepEqual(chunk, {
      type: 'tool-input-available',
      toolCallId: 'call1',
      toolName: 'Bash',
      input: { command: 'ls' },
      title: 'Bash · ls',
      dynamic: true,
    })
  })

  it('maps a failed tool call to tool-output-error', () => {
    const [chunk] = turnEventToUiChunks(
      row('tool_result', { toolCallId: 'call1', status: 'failed', content: 'nope' }),
    )
    assert.deepEqual(chunk, {
      type: 'tool-output-error',
      toolCallId: 'call1',
      errorText: 'nope',
      dynamic: true,
    })
  })

  it('maps approvals onto the SDK approval parts', () => {
    assert.deepEqual(turnEventToUiChunks(row('approval_request', { requestId: 'r1' })), [
      { type: 'tool-approval-request', approvalId: 'r1', toolCallId: 'r1' },
    ])
    assert.deepEqual(
      turnEventToUiChunks(row('approval_resolved', { requestId: 'r1', decision: 'allow' })),
      [{ type: 'tool-approval-response', approvalId: 'r1', approved: true }],
    )
  })

  it('sends the plan as a custom data part', () => {
    const [chunk] = turnEventToUiChunks(
      row('plan', { plan: [{ content: 'Fix it', status: 'pending', priority: 'medium' }] }),
    )
    assert.equal(chunk?.type, 'data-plan')
  })

  it('marks raw CLI noise transient so it stays out of message history', () => {
    const [chunk] = turnEventToUiChunks(row('raw', { text: '{oops' }))
    assert.deepEqual(chunk, { type: 'data-raw', data: { text: '{oops' }, transient: true })
  })

  it('drops events with no representation', () => {
    assert.deepEqual(turnEventToUiChunks(row('turn_done', { stopReason: 'end_turn' })), [])
    assert.deepEqual(turnEventToUiChunks(row('assistant', {})), [])
  })

  it('survives an unparseable payload', () => {
    const broken: TurnEventRow = { ...row('assistant', {}), payload: 'not json' }
    assert.deepEqual(turnEventToUiChunks(broken), [])
  })
})

describe('runToUiChunks', () => {
  it('wraps each assistant turn and skips user messages', () => {
    const chunks = runToUiChunks([
      { id: 'u1', role: 'user', events: [] },
      { id: 'a1', role: 'assistant', events: [row('assistant', { text: 'done' })] },
    ])
    assert.deepEqual(
      chunks.map((c) => c.type),
      ['start', 'start-step', 'text-start', 'text-delta', 'text-end', 'finish-step', 'finish'],
    )
    assert.equal((chunks[0] as { messageId?: string }).messageId, 'a1')
  })
})

describe('encodeUiSseFrame', () => {
  it('frames chunks and the terminator', () => {
    assert.equal(encodeUiSseFrame({ type: 'finish' }), 'data: {"type":"finish"}\n\n')
    assert.equal(encodeUiSseFrame('[DONE]'), 'data: [DONE]\n\n')
  })

  it('declares the protocol version header consumers look for', () => {
    assert.equal(UI_MESSAGE_STREAM_HEADERS['x-vercel-ai-ui-message-stream'], 'v1')
  })
})
