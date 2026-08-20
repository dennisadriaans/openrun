import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promptHasPlaceholders, renderWebhookPrompt, webhookSourceLink } from './prompt.ts'
import type { CanonicalWebhookEvent } from './types.ts'
import { emptyActor, emptyIssue } from './types.ts'

function sampleEvent(partial?: Partial<CanonicalWebhookEvent>): CanonicalWebhookEvent {
  return {
    provider: 'github',
    eventType: 'issues.opened',
    deliveryId: 'd1',
    occurredAt: 1,
    issue: emptyIssue({
      key: '#12',
      title: 'Fix flaky test',
      body: 'It flakes on CI',
      url: 'https://github.com/acme/app/issues/12',
      status: 'open',
      labels: ['bug'],
    }),
    actor: emptyActor({ name: 'ada' }),
    extra: { repository: 'acme/app' },
    ...partial,
  }
}

test('promptHasPlaceholders detects mustache paths', () => {
  assert.equal(promptHasPlaceholders('hello'), false)
  assert.equal(promptHasPlaceholders('Work on {{issue.title}}'), true)
})

test('renderWebhookPrompt substitutes placeholders', () => {
  const out = renderWebhookPrompt(
    'Handle {{issue.key}}: {{issue.title}} ({{event.type}})',
    sampleEvent(),
  )
  assert.equal(out, 'Handle #12: Fix flaky test (issues.opened)')
})

test('renderWebhookPrompt appends context when no placeholders', () => {
  const out = renderWebhookPrompt('Triage this issue carefully.', sampleEvent())
  assert.match(out, /Triage this issue carefully\./)
  assert.match(out, /Incoming webhook context/)
  assert.match(out, /Title: Fix flaky test/)
  assert.equal(out.includes('https://github.com/acme/app/issues/12'), false)
})

test('renderWebhookPrompt keeps the ticket URL out of the prompt', () => {
  const out = renderWebhookPrompt('Look at {{issue.key}}\n{{issue.url}}\n\n{{issue.body}}', sampleEvent())
  assert.equal(out.includes('https://github.com/acme/app/issues/12'), false)
  assert.match(out, /Look at #12\n\nIt flakes on CI/)
})

test('webhookSourceLink carries the URL the prompt dropped', () => {
  assert.deepEqual(webhookSourceLink(sampleEvent()), {
    provider: 'github',
    url: 'https://github.com/acme/app/issues/12',
    label: '#12',
  })
  assert.equal(webhookSourceLink(sampleEvent({ issue: emptyIssue({ key: '#1' }) })), null)
})
