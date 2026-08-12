import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectGhFailure } from './ghOutcome.ts'

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
