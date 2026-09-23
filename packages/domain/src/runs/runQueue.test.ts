import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_QUEUE_PER_TASK,
  isQueueableTrigger,
  queueDecision,
  queueDepthLabel,
  queuedRunMessage,
} from './runQueue.ts'

describe('isQueueableTrigger', () => {
  it('queues unattended triggers only', () => {
    assert.equal(isQueueableTrigger('schedule'), true)
    assert.equal(isQueueableTrigger('webhook'), true)
    assert.equal(isQueueableTrigger('manual'), false)
    assert.equal(isQueueableTrigger('chat'), false)
    assert.equal(isQueueableTrigger('planner'), false)
  })
})

describe('queueDecision', () => {
  it('refuses interactive triggers so the caller can say "workspace busy"', () => {
    assert.deepEqual(queueDecision({ taskId: 't1', trigger: 'manual', pending: [] }), {
      action: 'refuse',
    })
    assert.deepEqual(queueDecision({ taskId: 't1', trigger: 'chat', pending: [] }), {
      action: 'refuse',
    })
  })

  it('enqueues an unattended fire against a busy workspace', () => {
    assert.deepEqual(queueDecision({ taskId: 't1', trigger: 'schedule', pending: [] }), {
      action: 'enqueue',
    })
  })

  it('coalesces a second scheduled fire for the same automation', () => {
    const decision = queueDecision({
      taskId: 't1',
      trigger: 'schedule',
      pending: [{ taskId: 't1', trigger: 'schedule' }],
    })
    assert.equal(decision.action, 'coalesce')
  })

  it('does not coalesce across different automations', () => {
    const decision = queueDecision({
      taskId: 't2',
      trigger: 'schedule',
      pending: [{ taskId: 't1', trigger: 'schedule' }],
    })
    assert.equal(decision.action, 'enqueue')
  })

  it('stacks webhook fires — they are distinct events, not repeats', () => {
    const decision = queueDecision({
      taskId: 't1',
      trigger: 'webhook',
      pending: [{ taskId: 't1', trigger: 'webhook' }],
    })
    assert.equal(decision.action, 'enqueue')
  })

  it('lets a schedule queue behind a pending webhook for the same task', () => {
    const decision = queueDecision({
      taskId: 't1',
      trigger: 'schedule',
      pending: [{ taskId: 't1', trigger: 'webhook' }],
    })
    assert.equal(decision.action, 'enqueue')
  })

  it('drops past the per-automation cap rather than growing a backlog', () => {
    const pending = Array.from({ length: MAX_QUEUE_PER_TASK }, () => ({
      taskId: 't1',
      trigger: 'webhook',
    }))
    const decision = queueDecision({ taskId: 't1', trigger: 'webhook', pending })
    assert.equal(decision.action, 'drop')
    if (decision.action === 'drop') assert.match(decision.reason, /dropping this trigger/)
  })

  it('counts only the same automation against the cap', () => {
    const pending = Array.from({ length: MAX_QUEUE_PER_TASK }, () => ({
      taskId: 'other',
      trigger: 'webhook',
    }))
    assert.equal(queueDecision({ taskId: 't1', trigger: 'webhook', pending }).action, 'enqueue')
  })
})

describe('queue copy', () => {
  it('describes the wait', () => {
    assert.match(queuedRunMessage(1), /starts when the current one finishes/)
    assert.match(queuedRunMessage(3), /position 3/)
  })

  it('pluralises the depth label and hides an empty queue', () => {
    assert.equal(queueDepthLabel(0), '')
    assert.equal(queueDepthLabel(1), '1 run queued')
    assert.equal(queueDepthLabel(4), '4 runs queued')
  })
})
