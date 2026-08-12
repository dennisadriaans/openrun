import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertRuntimeBinaryAvailable,
  emptyRuntimeBinaryMessage,
  missingRuntimeBinaryMessage,
  normalizeBin,
} from './runtimeBinary.ts'

describe('normalizeBin', () => {
  it('trims and treats nullish as empty', () => {
    assert.equal(normalizeBin(undefined), '')
    assert.equal(normalizeBin(null), '')
    assert.equal(normalizeBin('  '), '')
    assert.equal(normalizeBin(' claude '), 'claude')
  })
})

describe('missingRuntimeBinaryMessage', () => {
  it('names the missing binary and points at Runtimes', () => {
    const msg = missingRuntimeBinaryMessage('codex')
    assert.match(msg, /"codex"/)
    assert.match(msg, /PATH/)
    assert.match(msg, /Runtimes/)
  })

  it('handles a blank bin without crashing', () => {
    assert.match(missingRuntimeBinaryMessage('   '), /\(empty\)/)
  })
})

describe('assertRuntimeBinaryAvailable', () => {
  it('returns the trimmed bin when installed', () => {
    assert.equal(assertRuntimeBinaryAvailable('  bash  ', true), 'bash')
  })

  it('throws when the binary name is empty', () => {
    assert.throws(
      () => assertRuntimeBinaryAvailable('', true),
      (err: Error) => {
        assert.equal(err.message, emptyRuntimeBinaryMessage())
        return true
      },
    )
    assert.throws(
      () => assertRuntimeBinaryAvailable('   ', true),
      (err: Error) => {
        assert.equal(err.message, emptyRuntimeBinaryMessage())
        return true
      },
    )
  })

  it('throws a clear message when not on PATH', () => {
    assert.throws(
      () => assertRuntimeBinaryAvailable('claude', false),
      (err: Error) => {
        assert.equal(err.message, missingRuntimeBinaryMessage('claude'))
        return true
      },
    )
  })
})
