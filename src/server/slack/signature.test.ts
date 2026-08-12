import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { SIGNATURE_MAX_AGE_MS, verifySlackRequest } from './signature.ts'

const SECRET = 'test-signing-secret'
const NOW = 1_700_000_000_000
const TIMESTAMP = String(Math.floor(NOW / 1000))
const BODY = 'token=abc&text=runs'

function sign(body: string, timestamp: string, secret = SECRET): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`
}

test('a genuine, fresh Slack request verifies', () => {
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW,
  })
  assert.equal(refusal, null)
})

test('a tampered body is refused', () => {
  const refusal = verifySlackRequest({
    rawBody: 'token=abc&text=cancel+%231',
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW,
  })
  assert.match(refusal ?? '', /signature did not match/)
})

test('a signature made with the wrong secret is refused', () => {
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP, 'not-the-secret'),
    timestamp: TIMESTAMP,
    now: NOW,
  })
  assert.match(refusal ?? '', /signature did not match/)
})

test('a captured request cannot be replayed later', () => {
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW + SIGNATURE_MAX_AGE_MS + 1000,
  })
  assert.match(refusal ?? '', /replay window/)
})

test('a request timestamped in the future is refused too', () => {
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW - SIGNATURE_MAX_AGE_MS - 1000,
  })
  assert.match(refusal ?? '', /replay window/)
})

test('missing headers are refused rather than skipped', () => {
  assert.match(
    verifySlackRequest({
      rawBody: BODY,
      signingSecret: SECRET,
      signature: null,
      timestamp: TIMESTAMP,
      now: NOW,
    }) ?? '',
    /Missing Slack signature headers/,
  )
  assert.match(
    verifySlackRequest({
      rawBody: BODY,
      signingSecret: SECRET,
      signature: sign(BODY, TIMESTAMP),
      timestamp: null,
      now: NOW,
    }) ?? '',
    /Missing Slack signature headers/,
  )
})

test('an unconfigured secret refuses instead of verifying nothing', () => {
  // Without this, an empty secret would make every forged request "valid".
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: '',
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW,
  })
  assert.match(refusal ?? '', /No Slack signing secret/)
})

test('a malformed timestamp is refused', () => {
  const refusal = verifySlackRequest({
    rawBody: BODY,
    signingSecret: SECRET,
    signature: sign(BODY, 'abc'),
    timestamp: 'abc',
    now: NOW,
  })
  assert.match(refusal ?? '', /Malformed Slack timestamp/)
})

test('a Buffer body verifies the same as a string body', () => {
  const refusal = verifySlackRequest({
    rawBody: Buffer.from(BODY, 'utf8'),
    signingSecret: SECRET,
    signature: sign(BODY, TIMESTAMP),
    timestamp: TIMESTAMP,
    now: NOW,
  })
  assert.equal(refusal, null)
})
