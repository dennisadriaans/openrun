import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promptHasPlaceholders, renderWebhookPrompt } from './prompt.ts'
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
  assert.match(out, /URL: https:\/\/github.com\/acme\/app\/issues\/12/)
})
