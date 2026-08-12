import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertTaskPrompt,
  emptyTaskPromptMessage,
  hasTaskPrompt,
  normalizeTaskPrompt,
} from './taskPrompt.ts'

describe('normalizeTaskPrompt', () => {
  it('trims and treats nullish as empty', () => {
    assert.equal(normalizeTaskPrompt(undefined), '')
    assert.equal(normalizeTaskPrompt(null), '')
    assert.equal(normalizeTaskPrompt('  '), '')
    assert.equal(normalizeTaskPrompt('  fix the flaky test  '), 'fix the flaky test')
  })
})

describe('hasTaskPrompt', () => {
  it('is false for blank values', () => {
    assert.equal(hasTaskPrompt(''), false)
    assert.equal(hasTaskPrompt('   \n\t  '), false)
    assert.equal(hasTaskPrompt(undefined), false)
    assert.equal(hasTaskPrompt(null), false)
  })

  it('is true for a real prompt', () => {
    assert.equal(hasTaskPrompt('Summarize recent commits'), true)
  })
})

describe('assertTaskPrompt', () => {
  it('returns the trimmed prompt', () => {
    assert.equal(assertTaskPrompt('  ship the fix  '), 'ship the fix')
  })

  it('throws a clear message when empty or whitespace-only', () => {
    assert.throws(() => assertTaskPrompt(''), (err: Error) => {
      assert.equal(err.message, emptyTaskPromptMessage())
      return true
    })
    assert.throws(() => assertTaskPrompt('   '), (err: Error) => {
      assert.equal(err.message, emptyTaskPromptMessage())
      return true
    })
    assert.throws(() => assertTaskPrompt(undefined), (err: Error) => {
      assert.equal(err.message, emptyTaskPromptMessage())
      return true
    })
  })
})
