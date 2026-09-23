import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectGhFailure, detectGhFailureInEvents } from './ghOutcome.ts'

test('detects unauthenticated gh', () => {
  const out = detectGhFailure(
    'You are not logged into any GitHub hosts. Run gh auth login to authenticate.',
  )
  assert.equal(out.failed, true)
  assert.match(out.reason!, /authenticat/i)
})

test('detects missing git remote', () => {
  const out = detectGhFailure('failed to create pull request: no git remotes found')
  assert.equal(out.failed, true)
  assert.match(out.reason!, /remote/i)
})

test('detects missing gh binary', () => {
  assert.equal(detectGhFailure('/bin/sh: gh: command not found').failed, true)
  assert.equal(detectGhFailure('command not found: gh').failed, true)
})

test('clean success output is not flagged', () => {
  const out = detectGhFailure('https://github.com/acme/repo/pull/42\nCreated pull request #42')
  assert.equal(out.failed, false)
  assert.equal(out.reason, undefined)
})

test('empty output is not flagged', () => {
  assert.equal(detectGhFailure('').failed, false)
})

test('authentication instructions alone are not a failure', () => {
  assert.equal(detectGhFailure('Use gh auth login to connect your account.').failed, false)
})

test('successful diagnostic output and quoted old failures do not fail the turn', () => {
  const content = 'You are not logged into any GitHub hosts. Run gh auth login to authenticate.'
  for (const kind of ['assistant', 'tool_start', 'tool_result'] as const) {
    assert.equal(
      detectGhFailureInEvents([{ kind, payload: JSON.stringify({ status: 'completed', content }) }])
        .failed,
      false,
    )
  }
  assert.equal(
    detectGhFailureInEvents([
      { kind: 'tool_result', payload: JSON.stringify({ status: 'failed', content }) },
    ]).failed,
    true,
  )
  assert.equal(detectGhFailureInEvents([{ kind: 'tool_result', payload: '{}' }]).failed, false)
})
