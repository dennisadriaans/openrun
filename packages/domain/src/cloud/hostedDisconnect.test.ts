import assert from 'node:assert/strict'
import test from 'node:test'
import { hostedDisconnectDecision } from './hostedDisconnect.ts'

test('404 means the control plane already forgot it, so the local row can go', () => {
  assert.deepEqual(hostedDisconnectDecision(404, { error: 'Unknown connection.' }), {
    dropLocal: true,
  })
})

test('401 keeps the local row so a later signed-in disconnect can still revoke the hook', () => {
  assert.deepEqual(hostedDisconnectDecision(401, { error: 'Unauthorized' }), {
    dropLocal: false,
    error: 'Sign in to Open Run first, then disconnect again.',
  })
})

test('vendor unregister failure still drops the local row and surfaces the warning', () => {
  assert.deepEqual(
    hostedDisconnectDecision(200, {
      remoteRemoved: false,
      remoteError: 'Jira webhook delete failed',
    }),
    {
      dropLocal: true,
      warning: 'Jira webhook delete failed',
    },
  )
})

test('a clean 200 drops the local row with no note', () => {
  assert.deepEqual(hostedDisconnectDecision(200, {}), { dropLocal: true })
})

test('a 5xx keeps the local row', () => {
  const result = hostedDisconnectDecision(502, { error: 'Bad gateway' })
  assert.equal(result.dropLocal, false)
  assert.equal(result.error, 'Bad gateway')
})
