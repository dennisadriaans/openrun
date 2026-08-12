import test from 'node:test'
import assert from 'node:assert/strict'

import { hasPendingApproval, pendingApprovals, resolvedApprovalIds } from './pendingApprovals.ts'
import type { TurnEventKind, TurnEventRow } from './turnEvents.ts'

let seq = 0

function ev(kind: TurnEventKind, payload: unknown, createdAt = 1_000 + seq): TurnEventRow {
  seq += 1
  return {
    id: `te_${seq}`,
    messageId: 'msg_1',
    runId: 'run_1',
    seq,
    kind,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    createdAt,
  }
}

test('a request with no resolution is pending', () => {
  const events = [
    ev('assistant', { text: 'thinking' }),
    ev('approval_request', { requestId: 'r1', name: 'Bash', input: { cmd: 'ls' } }),
  ]
  const pending = pendingApprovals(events)
  assert.equal(pending.length, 1)
  assert.equal(pending[0]!.requestId, 'r1')
  assert.equal(pending[0]!.toolName, 'Bash')
  assert.deepEqual(pending[0]!.input, { cmd: 'ls' })
  assert.equal(hasPendingApproval(events), true)
})

test('a resolved request is not pending', () => {
  const events = [
    ev('approval_request', { requestId: 'r1', name: 'Bash' }),
    ev('approval_resolved', { requestId: 'r1', decision: 'allow' }),
  ]
  assert.deepEqual(pendingApprovals(events), [])
  assert.equal(hasPendingApproval(events), false)
})

test('resolution is matched by requestId, not by order', () => {
  // r2 resolves before r1 is even requested — correlation is by id only.
  const events = [
    ev('approval_request', { requestId: 'r1', name: 'Write' }),
    ev('approval_request', { requestId: 'r2', name: 'Bash' }),
    ev('approval_resolved', { requestId: 'r2', decision: 'deny' }),
  ]
  const pending = pendingApprovals(events)
  assert.deepEqual(
    pending.map((p) => p.requestId),
    ['r1'],
  )
})

test('duplicate requestIds collapse to one pending entry', () => {
  const events = [
    ev('approval_request', { requestId: 'r1', name: 'Bash' }),
    ev('approval_request', { requestId: 'r1', name: 'Bash' }),
  ]
  assert.equal(pendingApprovals(events).length, 1)
})

test('a request without a requestId is skipped — it could never be answered', () => {
  const events = [ev('approval_request', { name: 'Bash' })]
  assert.deepEqual(pendingApprovals(events), [])
})

test('malformed payload JSON does not throw', () => {
  const events = [
    ev('approval_request', '{not json'),
    ev('approval_request', { requestId: 'r1', name: 'Bash' }),
    ev('approval_resolved', '}}}'),
  ]
  const pending = pendingApprovals(events)
  assert.deepEqual(
    pending.map((p) => p.requestId),
    ['r1'],
  )
})

test('toolName falls back to "tool" when the payload omits a name', () => {
  const events = [ev('approval_request', { requestId: 'r1' })]
  assert.equal(pendingApprovals(events)[0]!.toolName, 'tool')
})

test('pending entries come back oldest first', () => {
  const events = [
    ev('approval_request', { requestId: 'r1' }, 5_000),
    ev('approval_request', { requestId: 'r2' }, 6_000),
  ]
  assert.deepEqual(
    pendingApprovals(events).map((p) => p.requestId),
    ['r1', 'r2'],
  )
})

test('non-approval events are ignored entirely', () => {
  const events = [
    ev('user', { text: 'go' }),
    ev('tool_start', { name: 'Bash', toolCallId: 'c1' }),
    ev('tool_result', { toolCallId: 'c1', content: 'ok' }),
    ev('turn_done', {}),
  ]
  assert.deepEqual(pendingApprovals(events), [])
  assert.equal(hasPendingApproval(events), false)
})

test('resolvedApprovalIds reports every answered id', () => {
  const events = [
    ev('approval_request', { requestId: 'r1' }),
    ev('approval_resolved', { requestId: 'r1', decision: 'allow' }),
    ev('approval_resolved', { requestId: 'r2', decision: 'deny' }),
  ]
  assert.deepEqual([...resolvedApprovalIds(events)].sort(), ['r1', 'r2'])
})

test('an empty log has nothing pending', () => {
  assert.deepEqual(pendingApprovals([]), [])
  assert.equal(hasPendingApproval([]), false)
  assert.equal(resolvedApprovalIds([]).size, 0)
})
