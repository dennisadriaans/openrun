import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  eventMatchesFilters,
  eventTypeMatches,
  taskMatchesWebhookEvent,
} from './match.ts'
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from './types.ts'

const event: CanonicalWebhookEvent = {
  provider: 'jira',
  eventType: 'jira:issue_status_changed',
  deliveryId: 'x',
  occurredAt: null,
  issue: emptyIssue({
    key: 'ENG-9',
    status: 'In Progress',
    previousStatus: 'To Do',
    labels: ['agent', 'backend'],
    project: 'ENG',
    assignees: ['Ada'],
  }),
  actor: emptyActor(),
  extra: {},
}

test('eventTypeMatches treats empty allow-list as all', () => {
  assert.equal(eventTypeMatches('issues.opened', []), true)
  assert.equal(eventTypeMatches('issues.opened', ['issues.opened']), true)
  assert.equal(eventTypeMatches('issues.opened', ['issues.closed']), false)
})

test('eventMatchesFilters checks labels statuses and projects', () => {
  assert.equal(eventMatchesFilters(event, {}), true)
  assert.equal(eventMatchesFilters(event, { labels: ['agent'] }), true)
  assert.equal(eventMatchesFilters(event, { labels: ['frontend'] }), false)
  assert.equal(eventMatchesFilters(event, { statuses: ['in progress'] }), true)
  assert.equal(eventMatchesFilters(event, { previousStatuses: ['To Do'] }), true)
  assert.equal(eventMatchesFilters(event, { projects: ['eng'] }), true)
  assert.equal(eventMatchesFilters(event, { projects: ['DES'] }), false)
  assert.equal(eventMatchesFilters(event, { assignees: ['ada'] }), true)
  assert.equal(eventMatchesFilters(event, { assignees: ['Bob'] }), false)
})

test('taskMatchesWebhookEvent requires integration id and event filter', () => {
  assert.equal(
    taskMatchesWebhookEvent(
      {
        webhookIntegrationId: 'int_1',
        webhookEvents: '["jira:issue_status_changed"]',
        webhookFilters: '{}',
      },
      'int_1',
      event,
    ),
    true,
  )
  assert.equal(
    taskMatchesWebhookEvent(
      {
        webhookIntegrationId: 'int_1',
        webhookEvents: '["jira:issue_created"]',
        webhookFilters: '{}',
      },
      'int_1',
      event,
    ),
    false,
  )
  assert.equal(
    taskMatchesWebhookEvent(
      {
        webhookIntegrationId: 'int_other',
        webhookEvents: '[]',
        webhookFilters: '{}',
      },
      'int_1',
      event,
    ),
    false,
  )
})
