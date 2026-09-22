import test from 'node:test'
import assert from 'node:assert/strict'
import { draftAfterRefusal } from './composerDraft.ts'

test('a refused send puts the prompt back in an empty box', () => {
  assert.equal(draftAfterRefusal('fix the login page', ''), 'fix the login page')
})

test('text typed while the send was in flight is never clobbered', () => {
  assert.equal(draftAfterRefusal('fix the login page', 'something else'), 'something else')
})

test('a box holding only whitespace counts as empty', () => {
  assert.equal(draftAfterRefusal('fix the login page', '   \n '), 'fix the login page')
})

test('an empty prompt restores to empty rather than to undefined', () => {
  assert.equal(draftAfterRefusal('', ''), '')
})
