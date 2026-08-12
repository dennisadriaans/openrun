import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertWorkspaceId,
  hasWorkspaceId,
  missingWorkspaceMessage,
  normalizeWorkspaceId,
} from './workspaceRef.ts'

describe('normalizeWorkspaceId', () => {
  it('trims and treats nullish as empty', () => {
    assert.equal(normalizeWorkspaceId(undefined), '')
    assert.equal(normalizeWorkspaceId(null), '')
    assert.equal(normalizeWorkspaceId('  '), '')
    assert.equal(normalizeWorkspaceId(' ws_1 '), 'ws_1')
  })
})

describe('hasWorkspaceId', () => {
  it('is false for blank values', () => {
    assert.equal(hasWorkspaceId(''), false)
    assert.equal(hasWorkspaceId('   '), false)
    assert.equal(hasWorkspaceId(undefined), false)
  })

  it('is true for a real id', () => {
    assert.equal(hasWorkspaceId('ws_abc'), true)
  })
})

describe('assertWorkspaceId', () => {
  it('returns the trimmed id', () => {
    assert.equal(assertWorkspaceId('  ws_1  '), 'ws_1')
  })

  it('throws a clear message when missing', () => {
    assert.throws(() => assertWorkspaceId(''), (err: Error) => {
      assert.equal(err.message, missingWorkspaceMessage())
      return true
    })
    assert.throws(() => assertWorkspaceId(undefined), (err: Error) => {
      assert.equal(err.message, missingWorkspaceMessage())
      return true
    })
  })
})
