import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPkcePair, randomOAuthState } from './pkce.ts'

test('createPkcePair returns url-safe verifier and challenge', async () => {
  const pair = await createPkcePair()
  assert.match(pair.verifier, /^[A-Za-z0-9_-]+$/)
  assert.match(pair.challenge, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(pair.verifier, pair.challenge)
  const again = await createPkcePair()
  assert.notEqual(pair.verifier, again.verifier)
})

test('randomOAuthState is url-safe and unique', () => {
  const a = randomOAuthState()
  const b = randomOAuthState()
  assert.match(a, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(a, b)
})
