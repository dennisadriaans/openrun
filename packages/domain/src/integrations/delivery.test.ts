import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeWebhookDelivery, parseDeliveryRunIds } from './delivery.ts'

test('parseDeliveryRunIds reads a JSON string array', () => {
  assert.deepEqual(parseDeliveryRunIds('["run_a","run_b"]'), ['run_a', 'run_b'])
})

test('parseDeliveryRunIds tolerates empty, invalid, and non-array JSON', () => {
  assert.deepEqual(parseDeliveryRunIds(''), [])
  assert.deepEqual(parseDeliveryRunIds(null), [])
  assert.deepEqual(parseDeliveryRunIds('not-json'), [])
  assert.deepEqual(parseDeliveryRunIds('{"a":1}'), [])
  assert.deepEqual(parseDeliveryRunIds('[1,"run_x",""]'), ['run_x'])
})

test('describeWebhookDelivery flags ok with empty runIds as matched nothing', () => {
  const summary = describeWebhookDelivery({ status: 'ok', runIds: [], error: '' })
  assert.equal(summary.matchedNothing, true)
  assert.equal(summary.detail, 'matched nothing')
  assert.deepEqual(summary.runIds, [])
})

test('describeWebhookDelivery summarizes started runs', () => {
  assert.equal(describeWebhookDelivery({ status: 'ok', runIds: ['run_1'] }).detail, '1 run')
  assert.equal(
    describeWebhookDelivery({
      status: 'ok',
      runIds: '["run_1","run_2"]',
    }).detail,
    '2 runs',
  )
  assert.equal(
    describeWebhookDelivery({ status: 'ok', runIds: ['run_1', 'run_2'] }).matchedNothing,
    false,
  )
})

test('describeWebhookDelivery prefers error / queued detail over matched nothing', () => {
  const queued = describeWebhookDelivery({
    status: 'ok',
    runIds: [],
    error: 'queued: task_abc',
  })
  assert.equal(queued.matchedNothing, false)
  assert.equal(queued.detail, 'queued: task_abc')

  const failed = describeWebhookDelivery({
    status: 'error',
    runIds: [],
    error: 'task_x: workspace not ready',
  })
  assert.equal(failed.detail, 'task_x: workspace not ready')
  assert.equal(failed.matchedNothing, false)
})

test('describeWebhookDelivery labels ignored and duplicate', () => {
  assert.equal(
    describeWebhookDelivery({ status: 'ignored', runIds: [] }).detail,
    'ignored — no events',
  )
  assert.equal(
    describeWebhookDelivery({ status: 'duplicate', runIds: [] }).detail,
    'duplicate delivery',
  )
})

test('describeWebhookDelivery falls back for bare error status', () => {
  assert.equal(describeWebhookDelivery({ status: 'error', runIds: [] }).detail, 'error')
})
