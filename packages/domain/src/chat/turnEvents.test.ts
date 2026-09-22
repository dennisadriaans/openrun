import assert from 'node:assert/strict'
import test from 'node:test'
import { slimConversationEvent, type TurnEventRow } from './turnEvents.ts'

function event(kind: TurnEventRow['kind'], payload: object): TurnEventRow {
  return {
    id: 'ev_1',
    messageId: 'msg_1',
    runId: 'run_1',
    seq: 0,
    kind,
    payload: JSON.stringify(payload),
    createdAt: 1,
  }
}

test('conversation projection preserves long assistant prose', () => {
  const text = `Before the boundary. ${'complete answer '.repeat(500)}After the boundary.`
  const original = event('assistant', { text })

  assert.deepEqual(slimConversationEvent(original), original)
  assert.equal(JSON.parse(slimConversationEvent(original).payload).text, text)
})

test('conversation projection still bounds oversized tool output', () => {
  const original = event('tool_result', { content: 'x'.repeat(8_000) })
  const slimmed = slimConversationEvent(original)

  assert.ok(slimmed.payload.length <= 4_000)
  assert.match(JSON.parse(slimmed.payload).content, /…$/)
})
