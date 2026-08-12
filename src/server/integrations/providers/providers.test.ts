import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  hmacSha256Hex,
  verifyHexHmacSignature,
  verifySha256PrefixedSignature,
} from '../crypto.ts'
import { githubProvider } from './github.ts'
import { jiraProvider } from './jira.ts'
import { linearProvider } from './linear.ts'

const secret = 'test-secret-value'

test('verifySha256PrefixedSignature matches GitHub/Jira style headers', () => {
  const body = Buffer.from('{"ok":true}')
  const hex = hmacSha256Hex(secret, body)
  assert.equal(verifySha256PrefixedSignature(secret, body, `sha256=${hex}`), true)
  assert.equal(verifySha256PrefixedSignature(secret, body, `sha256=deadbeef`), false)
  assert.equal(verifySha256PrefixedSignature(secret, body, null), false)
})

test('verifyHexHmacSignature matches Linear style headers', () => {
  const body = Buffer.from('{"ok":true}')
  const hex = hmacSha256Hex(secret, body)
  assert.equal(verifyHexHmacSignature(secret, body, hex), true)
  assert.equal(verifyHexHmacSignature(secret, body, 'nope'), false)
})

test('github provider parses issues.opened', () => {
  const payload = {
    action: 'opened',
    issue: {
      id: 1,
      number: 42,
      title: 'Hello',
      body: 'World',
      html_url: 'https://github.com/acme/app/issues/42',
      state: 'open',
      labels: [{ name: 'bug' }],
      assignees: [{ login: 'ada' }],
    },
    repository: { full_name: 'acme/app' },
    sender: { login: 'ada' },
  }
  const raw = JSON.stringify(payload)
  const headers = new Headers({
    'x-github-event': 'issues',
    'x-github-delivery': 'deliv-1',
  })
  const events = githubProvider.parse({ rawBody: raw, headers, payload })
  assert.equal(events.length, 1)
  assert.equal(events[0]!.eventType, 'issues.opened')
  assert.equal(events[0]!.issue.key, '#42')
  assert.equal(events[0]!.issue.title, 'Hello')
  assert.deepEqual(events[0]!.issue.labels, ['bug'])
})

test('github provider ignores ping', () => {
  const headers = new Headers({ 'x-github-event': 'ping' })
  assert.deepEqual(
    githubProvider.parse({ rawBody: '{}', headers, payload: {} }),
    [],
  )
})

test('jira provider derives status_changed from changelog', () => {
  const payload = {
    webhookEvent: 'jira:issue_updated',
    timestamp: 1_700_000_000_000,
    issue: {
      id: '10001',
      key: 'ENG-3',
      self: 'https://example.atlassian.net/rest/api/2/issue/10001',
      fields: {
        summary: 'Ship it',
        status: { name: 'Done' },
        labels: ['agent'],
        project: { key: 'ENG' },
      },
    },
    user: { displayName: 'Ada' },
    changelog: {
      items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }],
    },
  }
  const events = jiraProvider.parse({
    rawBody: JSON.stringify(payload),
    headers: new Headers({ 'x-atlassian-webhook-identifier': 'jid-1' }),
    payload,
  })
  const types = events.map((e) => e.eventType)
  assert.ok(types.includes('jira:issue_updated'))
  assert.ok(types.includes('jira:issue_status_changed'))
  const statusEv = events.find((e) => e.eventType === 'jira:issue_status_changed')!
  assert.equal(statusEv.issue.previousStatus, 'In Progress')
  assert.equal(statusEv.issue.status, 'Done')
  assert.equal(statusEv.issue.url, 'https://example.atlassian.net/browse/ENG-3')
})

test('linear provider verifies signature and timestamp', () => {
  const payload = {
    action: 'create',
    type: 'Issue',
    webhookTimestamp: Date.now(),
    data: {
      id: 'iss_1',
      identifier: 'ENG-1',
      title: 'New',
      description: 'Body',
      url: 'https://linear.app/acme/issue/ENG-1',
      state: { name: 'Todo' },
    },
    actor: { name: 'Ada' },
  }
  const raw = Buffer.from(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(raw).digest('hex')
  assert.equal(
    linearProvider.verify({
      rawBody: raw,
      headers: new Headers({ 'linear-signature': sig }),
      secret,
      payload,
    }),
    true,
  )
  assert.equal(
    linearProvider.verify({
      rawBody: raw,
      headers: new Headers({ 'linear-signature': 'bad' }),
      secret,
      payload,
    }),
    false,
  )
})

test('linear provider derives status_changed on stateId update', () => {
  const payload = {
    action: 'update',
    type: 'Issue',
    webhookTimestamp: Date.now(),
    data: {
      id: 'iss_1',
      identifier: 'ENG-1',
      title: 'New',
      stateId: 'state_done',
      state: { name: 'Done' },
    },
    updatedFrom: { stateId: 'state_todo' },
  }
  const events = linearProvider.parse({
    rawBody: JSON.stringify(payload),
    headers: new Headers({ 'linear-delivery': 'ld-1' }),
    payload,
  })
  assert.ok(events.some((e) => e.eventType === 'Issue.update'))
  assert.ok(events.some((e) => e.eventType === 'Issue.status_changed'))
})
