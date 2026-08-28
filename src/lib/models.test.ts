import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type ModelOption,
  defaultModel,
  hiddenModelsIn,
  modelKindForBin,
  modelsForRuntime,
  toggleHiddenModel,
  visibleModels,
} from './models.ts'

function model(slug: string): ModelOption {
  return { slug, name: slug, shortName: slug, efforts: [], provider: 'claude' }
}

const CATALOG = [model('opus-5'), model('sonnet-5'), model('sonnet-4-6'), model('haiku-4-5')]

test('hiding removes models from the picker', () => {
  assert.deepEqual(
    visibleModels(CATALOG, ['sonnet-4-6', 'haiku-4-5']).map((m) => m.slug),
    ['opus-5', 'sonnet-5'],
  )
})

test('nothing is hidden when the list is empty or absent', () => {
  assert.equal(visibleModels(CATALOG, []).length, 4)
  assert.equal(visibleModels(CATALOG, undefined).length, 4)
})

test('the selected model survives being hidden', () => {
  // A run already on Sonnet 4.6 must still show what it is using, or the
  // trigger button names a model the menu does not contain.
  assert.deepEqual(
    visibleModels(CATALOG, ['sonnet-4-6'], 'sonnet-4-6').map((m) => m.slug),
    ['opus-5', 'sonnet-5', 'sonnet-4-6', 'haiku-4-5'],
  )
})

test('hiding every model falls back to the full catalog rather than an empty menu', () => {
  const all = CATALOG.map((m) => m.slug)
  assert.deepEqual(
    visibleModels(CATALOG, all).map((m) => m.slug),
    all,
  )
})

test('hidden models are listed in catalog order for the unhide UI', () => {
  assert.deepEqual(
    hiddenModelsIn(CATALOG, ['haiku-4-5', 'sonnet-4-6']).map((m) => m.slug),
    ['sonnet-4-6', 'haiku-4-5'],
  )
  assert.deepEqual(hiddenModelsIn(CATALOG, undefined), [])
})

test('a hidden model kept as the selection is not also listed as hidden', () => {
  // It stays in the picker so the composer can show what the run is using;
  // listing it on both sides would let the user "unhide" something on screen.
  assert.deepEqual(
    hiddenModelsIn(CATALOG, ['sonnet-4-6', 'haiku-4-5'], 'sonnet-4-6').map((m) => m.slug),
    ['haiku-4-5'],
  )
})

test('toggling a model flips it in and out of the hidden list', () => {
  assert.deepEqual(toggleHiddenModel(undefined, 'sonnet-4-6'), ['sonnet-4-6'])
  assert.deepEqual(toggleHiddenModel(['sonnet-4-6'], 'haiku-4-5'), ['sonnet-4-6', 'haiku-4-5'])
  assert.deepEqual(toggleHiddenModel(['sonnet-4-6', 'haiku-4-5'], 'sonnet-4-6'), ['haiku-4-5'])
})

test('a hidden top model stops being the default for a new chat', () => {
  assert.equal(defaultModel(visibleModels(CATALOG, ['opus-5']))?.slug, 'sonnet-5')
})

test('antigravity binaries map to their own catalog', () => {
  assert.equal(modelKindForBin('agy'), 'antigravity')
  assert.equal(modelKindForBin('/opt/homebrew/bin/agy'), 'antigravity')
  assert.equal(modelKindForBin('claude'), 'claude')
})

test('fx binaries map to their own catalog', () => {
  assert.equal(modelKindForBin('fx'), 'fx')
  assert.equal(modelKindForBin('/usr/local/bin/fx'), 'fx')
  assert.equal(modelKindForBin('fx.exe'), 'fx')
  assert.equal(modelKindForBin('fx-json'), 'generic')
})

test('a runtime prefers the catalog the server discovered', () => {
  const discovered = [model('claude-opus-5')]
  assert.deepEqual(modelsForRuntime({ bin: 'claude', models: discovered }), discovered)
  // No discovery yet — fall back to the static seed rather than an empty picker.
  assert.ok(modelsForRuntime({ bin: 'claude' }).length > 0)
  assert.ok(modelsForRuntime({ bin: 'claude', models: [] }).length > 0)
  assert.ok(modelsForRuntime({ bin: 'fx' }).length > 0)
})
