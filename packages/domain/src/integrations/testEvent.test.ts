import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from './types.ts'
import { taskMatchesWebhookEvent } from './match.ts'
import { testEventShape, type TestEventBinding } from './testEvent.ts'

function eventFrom(provider: 'linear' | 'github', bindings: TestEventBinding[]) {
  const shape = testEventShape(provider, bindings)
  const event: CanonicalWebhookEvent = {
    provider,
    eventType: shape.eventType,
    deliveryId: 'test_1',
    occurredAt: 1,
    issue: emptyIssue({
      key: 'TEST-1',
      title: 'Test webhook event',
      labels: shape.labels,
      status: shape.status,
      previousStatus: shape.previousStatus,
      assignees: shape.assignees,
      project: shape.project,
    }),
    actor: emptyActor({ name: 'Open Run' }),
    extra: { source: 'test' },
  }
  return event
}

function task(events: string[], filters: object) {
  return {
    webhookIntegrationId: 'int_1',
    webhookEvents: JSON.stringify(events),
    webhookFilters: JSON.stringify(filters),
  }
}

test('with nothing bound, the created event is sent', () => {
  assert.equal(testEventShape('linear', []).eventType, 'Issue.create')
  assert.equal(testEventShape('github', []).eventType, 'issues.opened')
})

/**
 * The whole point: a connection whose only automation watches comments used to
 * be told "0 automations matched" by its own test button.
 */
test('the sent event is the one the automation binds', () => {
  const bindings = [{ events: ['Comment.create'], filters: {} }]
  const event = eventFrom('linear', bindings)

  assert.equal(event.eventType, 'Comment.create')
  assert.equal(taskMatchesWebhookEvent(task(['Comment.create'], {}), 'int_1', event), true)
})

test('the issue satisfies the label, status and assignee filters', () => {
  const filters = { labels: ['agent'], statuses: ['In Progress'], assignees: ['dennis'] }
  const bindings = [{ events: ['Issue.update'], filters }]
  const event = eventFrom('linear', bindings)

  assert.deepEqual(event.issue.labels, ['agent'])
  assert.equal(event.issue.status, 'In Progress')
  assert.deepEqual(event.issue.assignees, ['dennis'])
  assert.equal(taskMatchesWebhookEvent(task(['Issue.update'], filters), 'int_1', event), true)
})

/** An "every event" custom binding stores no ids but still has to receive one. */
test('a binding with no event ids still gets a real event type', () => {
  const event = eventFrom('github', [{ events: [], filters: { labels: ['bug'] } }])

  assert.equal(event.eventType, 'issues.opened')
  assert.deepEqual(event.issue.labels, ['bug'])
  assert.equal(taskMatchesWebhookEvent(task([], { labels: ['bug'] }), 'int_1', event), true)
})

/** A previousStatus filter is what a "moved to" trigger compiles to on Jira. */
test('previousStatus is filled when the binding narrows on it', () => {
  const shape = testEventShape('linear', [
    { events: ['Issue.status_changed'], filters: { previousStatuses: ['To Do'] } },
  ])

  assert.equal(shape.previousStatus, 'To Do')
})
