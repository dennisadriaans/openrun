import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTIVITY_LIVE_RESUME_KEYS,
  activityLiveInvalidateKeys,
  activityLiveStreamPath,
} from './activityLive.ts'

describe('activityLiveInvalidateKeys', () => {
  it('refetches list pages when a run starts or finishes', () => {
    assert.deepEqual(
      activityLiveInvalidateKeys({
        type: 'run_changed',
        runId: 'r1',
        status: 'running',
      }),
      [['runs'], ['dashboard'], ['tasks']],
    )
  })

  it('refetches dashboard and automations when queue depth changes', () => {
    // No run row yet — must not wait for a coincidental run_changed while
    // stream-healthy polling is off.
    assert.deepEqual(
      activityLiveInvalidateKeys({
        type: 'queue_changed',
        workspaceId: 'ws1',
        queued: 2,
      }),
      [['dashboard'], ['tasks']],
    )
  })

  it('surfaces and clears a pending approval on list pages', () => {
    // The prompt lives in the conversation, but the "waiting on you" badge is
    // on the list — a phone not sitting on the run has to learn about it here.
    assert.deepEqual(
      activityLiveInvalidateKeys({
        type: 'approval_pending',
        runId: 'r1',
        requestId: 'req1',
        toolName: 'Bash',
        expiresAt: 1_000,
      }),
      [['conversation', 'r1'], ['runs'], ['dashboard']],
    )
    assert.deepEqual(
      activityLiveInvalidateKeys({
        type: 'approval_settled',
        runId: 'r1',
        requestId: 'req1',
        decision: 'allow',
      }),
      [['conversation', 'r1'], ['runs'], ['dashboard']],
    )
  })

  it('ignores hello and ping frames', () => {
    assert.deepEqual(activityLiveInvalidateKeys({ type: 'hello' }), [])
    assert.deepEqual(activityLiveInvalidateKeys({ type: 'ping' }), [])
  })

  it('does not drop every conversation cache on stream resume', () => {
    assert.deepEqual(ACTIVITY_LIVE_RESUME_KEYS, [['runs'], ['dashboard'], ['tasks']])
  })
})

describe('activityLiveStreamPath', () => {
  it('points at the activity SSE route', () => {
    assert.equal(activityLiveStreamPath(), '/api/activity/stream')
  })
})
