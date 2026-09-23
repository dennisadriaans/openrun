import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveRuntimeLabel } from './runtimeLabel.ts'

describe('resolveRuntimeLabel', () => {
  it('prefers a trimmed display label', () => {
    assert.equal(resolveRuntimeLabel(' Claude Code ', 'claude'), 'Claude Code')
  })

  it('falls back to runtime id when label is blank', () => {
    assert.equal(resolveRuntimeLabel('', 'claude'), 'claude')
    assert.equal(resolveRuntimeLabel('   ', 'codex'), 'codex')
    assert.equal(resolveRuntimeLabel(null, 'grok'), 'grok')
    assert.equal(resolveRuntimeLabel(undefined, 'gemini'), 'gemini')
  })

  it('returns a stable unknown label when both are blank', () => {
    assert.equal(resolveRuntimeLabel(''), 'Unknown runtime')
    assert.equal(resolveRuntimeLabel(null, null), 'Unknown runtime')
    assert.equal(resolveRuntimeLabel(undefined, '  '), 'Unknown runtime')
  })
})
