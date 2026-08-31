import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  truncateBranchLabel,
  truncateEnd,
  truncateMiddle,
  truncateNavTitle,
} from './truncateLabel.ts'

describe('truncateMiddle', () => {
  it('returns short strings unchanged', () => {
    assert.equal(truncateMiddle('main', 20), 'main')
  })

  it('keeps both ends', () => {
    assert.equal(truncateMiddle('organize-chat-navigation', 18), 'organize-…vigation')
  })
})

describe('truncateEnd', () => {
  it('collapses whitespace and clips on a word boundary slice', () => {
    assert.equal(truncateEnd('hello   world', 8), 'hello w…')
  })
})

describe('truncateBranchLabel', () => {
  it('keeps the branch prefix', () => {
    assert.equal(
      truncateBranchLabel('feature/organize-chat-navigation', 26),
      'feature/organize-…vigation',
    )
  })

  it('falls back to middle truncation without a slash', () => {
    assert.equal(truncateBranchLabel('very-long-branch-name-here', 20), 'very-long-…name-here')
  })
})

describe('truncateNavTitle', () => {
  it('clips long chat titles', () => {
    const long = 'Organize the chat navigation so branch and runtime names fit in the header'
    assert.equal(truncateNavTitle(long, 36).length, 36)
    assert.match(truncateNavTitle(long, 36), /…$/)
  })
})
