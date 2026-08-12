import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRelayServerMessage } from './types.ts'

test('parseRelayServerMessage accepts hello_ok and webhook.event', () => {
  const hello = parseRelayServerMessage(
    JSON.stringify({ type: 'hello_ok', userId: 'u1', email: 'a@b.c' }),
  )
  assert.equal(hello?.type, 'hello_ok')
  if (hello?.type === 'hello_ok') assert.equal(hello.email, 'a@b.c')

  const event = parseRelayServerMessage(
    JSON.stringify({
      type: 'webhook.event',
      cloudConnectionId: 'jconn_1',
      event: { provider: 'jira', eventType: 'jira:issue_created', deliveryId: 'd1' },
    }),
  )
  assert.equal(event?.type, 'webhook.event')
})

test('parseRelayServerMessage rejects junk', () => {
  assert.equal(parseRelayServerMessage('not-json'), null)
  assert.equal(parseRelayServerMessage('{"type":"nope"}'), null)
  assert.equal(parseRelayServerMessage('[]'), null)
})
