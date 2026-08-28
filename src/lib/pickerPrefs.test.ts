import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyPatch, pickerPrefForRuntime, type PickerPrefs } from './pickerPrefs.ts'

describe('applyPatch', () => {
  it('sets the last-used runtime and mode', () => {
    const next = applyPatch({}, { runtimeId: 'claude', runtimeMode: 'full-access' })
    assert.equal(next.runtimeId, 'claude')
    assert.equal(next.runtimeMode, 'full-access')
  })

  it('scopes model/effort under forRuntimeId', () => {
    const next = applyPatch({}, { forRuntimeId: 'codex', model: 'gpt-5.5', effort: 'high' })
    assert.deepEqual(next.byRuntime?.codex, { model: 'gpt-5.5', effort: 'high' })
  })

  it('falls back to runtimeId, then the existing runtime, for scope', () => {
    const withRuntime = applyPatch({}, { runtimeId: 'claude', model: 'claude-opus-4-8' })
    assert.equal(withRuntime.byRuntime?.claude?.model, 'claude-opus-4-8')

    const withPrev = applyPatch({ runtimeId: 'claude' }, { effort: 'max' })
    assert.equal(withPrev.byRuntime?.claude?.effort, 'max')
  })

  it('keeps per-runtime prefs independent when switching runtimes', () => {
    let prefs: PickerPrefs = {}
    prefs = applyPatch(prefs, { runtimeId: 'claude', model: 'claude-haiku-4-5', effort: '' })
    prefs = applyPatch(prefs, { runtimeId: 'codex', model: 'gpt-5.5', effort: 'high' })
    assert.equal(prefs.runtimeId, 'codex')
    assert.equal(prefs.byRuntime?.claude?.model, 'claude-haiku-4-5')
    assert.equal(prefs.byRuntime?.codex?.model, 'gpt-5.5')
  })

  it('merges effort without clobbering a previously stored model', () => {
    let prefs = applyPatch({}, { forRuntimeId: 'claude', model: 'claude-opus-4-8', effort: 'high' })
    prefs = applyPatch(prefs, { forRuntimeId: 'claude', effort: 'low' })
    assert.deepEqual(prefs.byRuntime?.claude, { model: 'claude-opus-4-8', effort: 'low' })
  })
})

describe('pickerPrefForRuntime', () => {
  it('returns the stored pref for a runtime', () => {
    const prefs: PickerPrefs = {
      byRuntime: { claude: { model: 'claude-opus-4-8', effort: 'high' } },
    }
    assert.deepEqual(pickerPrefForRuntime(prefs, 'claude'), {
      model: 'claude-opus-4-8',
      effort: 'high',
    })
  })

  it('returns an empty object for unknown or missing runtime', () => {
    assert.deepEqual(pickerPrefForRuntime({}, 'claude'), {})
    assert.deepEqual(pickerPrefForRuntime({ byRuntime: {} }, undefined), {})
  })
})

describe('hidden models', () => {
  it('round-trips through a patch so the choice survives a reload', () => {
    const next = applyPatch({}, { hiddenModels: ['claude-sonnet-4-6'] })
    assert.deepEqual(next.hiddenModels, ['claude-sonnet-4-6'])
    // Unrelated patches must not drop it.
    assert.deepEqual(applyPatch(next, { runtimeId: 'claude' }).hiddenModels, ['claude-sonnet-4-6'])
  })
})

describe('hidden runtimes', () => {
  it('round-trips through a patch so the choice survives a reload', () => {
    const next = applyPatch({}, { hiddenRuntimes: ['grok'] })
    assert.deepEqual(next.hiddenRuntimes, ['grok'])
    assert.deepEqual(applyPatch(next, { runtimeId: 'claude' }).hiddenRuntimes, ['grok'])
  })
})
