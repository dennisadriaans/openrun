import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hiddenRuntimesIn,
  pickDefaultRuntime,
  pickDefaultRuntimeId,
  toggleHiddenRuntime,
  visibleRuntimes,
} from './pickRuntime.ts'

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

const catalog = [{ id: 'claude' }, { id: 'codex' }, { id: 'grok' }, { id: 'gemini' }]

describe('visibleRuntimes', () => {
  it('hides listed runtimes from the picker', () => {
    assert.deepEqual(
      visibleRuntimes(catalog, ['grok', 'gemini']).map((r) => r.id),
      ['claude', 'codex'],
    )
  })

  it('keeps the selected runtime even when it is hidden', () => {
    assert.deepEqual(
      visibleRuntimes(catalog, ['grok'], 'grok').map((r) => r.id),
      ['claude', 'codex', 'grok', 'gemini'],
    )
  })

  it('falls back to the full catalog rather than an empty menu', () => {
    const all = catalog.map((r) => r.id)
    assert.deepEqual(
      visibleRuntimes(catalog, all).map((r) => r.id),
      all,
    )
  })

  it('does not pick a hidden runtime as the default for a new chat', () => {
    assert.equal(
      pickDefaultRuntime(visibleRuntimes([missing, installed, codex], ['gemini']))?.id,
      'claude',
    )
  })
})

describe('hiddenRuntimesIn', () => {
  it('lists hidden runtimes in catalog order for the unhide UI', () => {
    assert.deepEqual(
      hiddenRuntimesIn(catalog, ['gemini', 'grok']).map((r) => r.id),
      ['grok', 'gemini'],
    )
    assert.deepEqual(hiddenRuntimesIn(catalog, undefined), [])
  })

  it('does not also list a hidden runtime kept as the selection', () => {
    assert.deepEqual(
      hiddenRuntimesIn(catalog, ['grok', 'gemini'], 'grok').map((r) => r.id),
      ['gemini'],
    )
  })
})

describe('toggleHiddenRuntime', () => {
  it('flips a runtime in and out of the hidden list', () => {
    assert.deepEqual(toggleHiddenRuntime(undefined, 'grok'), ['grok'])
    assert.deepEqual(toggleHiddenRuntime(['grok'], 'gemini'), ['grok', 'gemini'])
    assert.deepEqual(toggleHiddenRuntime(['grok', 'gemini'], 'grok'), ['gemini'])
  })
})
