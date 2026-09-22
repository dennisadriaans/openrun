import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ACTIVITY_LIVE_RESUME_KEYS,
  activityLiveInvalidateKeys,
  activityLiveStreamPath,
  needsActivityLiveStream,
  createActivityBatch,
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

  it('refreshes automation health when a scheduled fire settles', () => {
    assert.deepEqual(activityLiveInvalidateKeys({ type: 'task_changed', taskId: 'task-1' }), [
      ['task', 'task-1'],
      ['dashboard'],
      ['tasks'],
    ])
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

describe('needsActivityLiveStream', () => {
  it('keeps the app-wide stream on list and creation pages', () => {
    assert.equal(needsActivityLiveStream('/'), true)
    assert.equal(needsActivityLiveStream('/runs'), true)
    assert.equal(needsActivityLiveStream('/runs/new'), true)
  })

  it('uses only the run-scoped stream on a run detail', () => {
    assert.equal(needsActivityLiveStream('/runs/run_123'), false)
    assert.equal(needsActivityLiveStream('/runs/run_123/'), false)
  })
})

describe('activity batching', () => {
  it('refreshes within 100ms even when events keep arriving', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const invalidated: (readonly string[])[] = []
    const batch = createActivityBatch((key) => invalidated.push(key))
    t.after(() => batch.close())
    for (let i = 0; i < 5; i++) {
      batch.bump([['runs'], ['dashboard']])
      t.mock.timers.tick(20)
    }
    assert.deepEqual(invalidated, [['runs'], ['dashboard']])
    batch.bump([['runs'], ['task', 'task-1']])
    t.mock.timers.tick(100)
    assert.deepEqual(invalidated, [['runs'], ['dashboard'], ['runs'], ['task', 'task-1']])
  })

  it('does not invalidate after unmount', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const invalidated: (readonly string[])[] = []
    const batch = createActivityBatch((key) => invalidated.push(key))
    batch.bump([['runs']])
    batch.close()
    t.mock.timers.tick(100)
    assert.deepEqual(invalidated, [])
  })
})
