import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickDefaultRuntime, pickDefaultRuntimeId } from './pickRuntime.ts'

const missing = { id: 'claude', installed: false }
const installed = { id: 'gemini', installed: true }
const codex = { id: 'codex', installed: false }

describe('pickDefaultRuntime', () => {
  it('returns undefined for an empty list', () => {
    assert.equal(pickDefaultRuntime([]), undefined)
    assert.equal(pickDefaultRuntime([], 'claude'), undefined)
  })

  it('prefers the remembered id when it still exists', () => {
    assert.equal(pickDefaultRuntime([missing, installed, codex], 'codex')?.id, 'codex')
  })

  it('ignores a remembered id that is no longer in the list', () => {
    assert.equal(pickDefaultRuntime([missing, installed], 'gone')?.id, 'gemini')
  })

  it('falls back to the first installed runtime', () => {
    assert.equal(pickDefaultRuntime([missing, installed, codex])?.id, 'gemini')
  })

  it('falls back to the first row when nothing is installed', () => {
    assert.equal(pickDefaultRuntime([missing, codex])?.id, 'claude')
  })

  it('treats blank preferred ids as absent', () => {
    assert.equal(pickDefaultRuntime([missing, installed], '   ')?.id, 'gemini')
    assert.equal(pickDefaultRuntime([missing, installed], null)?.id, 'gemini')
    assert.equal(pickDefaultRuntime([missing, installed], undefined)?.id, 'gemini')
  })

  it('keeps a remembered runtime even when it is not installed', () => {
    // Matches Projects chat: last-used wins over "first installed".
    assert.equal(pickDefaultRuntime([missing, installed], 'claude')?.id, 'claude')
  })
})

describe('pickDefaultRuntimeId', () => {
  it('returns only the id', () => {
    assert.equal(pickDefaultRuntimeId([missing, installed]), 'gemini')
    assert.equal(pickDefaultRuntimeId([]), undefined)
  })
})
