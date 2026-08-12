import assert from 'node:assert/strict'
import { test } from 'node:test'
import { editionFromSession } from './edition.ts'
import { DEFAULT_CLOUD_URL } from './url.ts'

test('signed out is local even with the default cloud URL', () => {
  assert.equal(editionFromSession({ hasSession: false }), 'local')
  assert.equal(editionFromSession({ cloudUrl: DEFAULT_CLOUD_URL, hasSession: false }), 'local')
})

test('signed in against a usable URL is connected', () => {
  assert.equal(editionFromSession({ hasSession: true }), 'connected')
  assert.equal(
    editionFromSession({ cloudUrl: 'http://127.0.0.1:8787', hasSession: true }),
    'connected',
  )
})

test('signed in with cloud disabled stays local', () => {
  assert.equal(editionFromSession({ cloudUrl: 'off', hasSession: true }), 'local')
})
