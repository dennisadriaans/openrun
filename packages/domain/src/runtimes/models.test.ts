import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type ModelOption,
  defaultModel,
  hiddenModelsIn,
  materializeHiddenModels,
  modelKindForBin,
  modelsForRuntime,
  recentModels,
  toggleHiddenModel,
  visibleModels,
} from './models.ts'

function model(slug: string, preferred?: boolean): ModelOption {
  return {
    slug,
    name: slug,
    shortName: slug,
    efforts: [],
    provider: 'claude',
    ...(preferred ? { preferred: true } : {}),
  }
}

const CATALOG = [model('opus-5'), model('sonnet-5'), model('sonnet-4-6'), model('haiku-4-5')]

/**
 * What discovery actually returns: the CLI ships its whole registry, so models
 * the account has no entitlement for sort above the one it defaults to.
 */
const GATED = [
  model('mythos-1'),
  model('fable-2'),
  model('opus-5', true),
  model('sonnet-5'),
  model('sonnet-4-6'),
  model('haiku-4-5'),
]

test('hiding removes models from the picker', () => {
  assert.deepEqual(
    visibleModels(CATALOG, ['sonnet-4-6', 'haiku-4-5']).map((m) => m.slug),
    ['opus-5', 'sonnet-5'],
  )
})

test('an explicitly emptied list shows the whole catalog', () => {
  assert.equal(visibleModels(CATALOG, []).length, 4)
})

test('by default a picker offers only the recent models', () => {
  // No stored list at all — a fresh install, and every existing user who has
  // never curated one. The catalog arrives newest-first, so the tail is the
  // superseded generations.
  assert.deepEqual(
    visibleModels(CATALOG, undefined).map((m) => m.slug),
    ['opus-5', 'sonnet-5', 'sonnet-4-6'],
  )
})

test('the default starts at the model the CLI itself would run', () => {
  // Mythos and Fable are in the bundle but not on this account; the CLI would
  // not default to a model it cannot run, so `preferred` anchors the window
  // and the picker opens on models that actually work.
  assert.deepEqual(
    visibleModels(GATED, undefined).map((m) => m.slug),
    ['opus-5', 'sonnet-5', 'sonnet-4-6'],
  )
})

test('a new chat preselects the CLI default, not a model above it', () => {
  assert.equal(defaultModel(visibleModels(GATED, undefined))?.slug, 'opus-5')
})

test('models above the CLI default stay reachable behind the reveal', () => {
  assert.deepEqual(
    hiddenModelsIn(GATED, undefined).map((m) => m.slug),
    ['mythos-1', 'fable-2', 'haiku-4-5'],
  )
})

test('a chat pinned above the default still shows its own model', () => {
  assert.deepEqual(
    visibleModels(GATED, undefined, 'fable-2').map((m) => m.slug),
    ['fable-2', 'opus-5', 'sonnet-5', 'sonnet-4-6'],
  )
})

test('without a preferred marker the window starts at the top', () => {
  // Static seeds carry no marker, and CLIs whose discovery reports none.
  assert.deepEqual(
    recentModels(CATALOG).map((m) => m.slug),
    ['opus-5', 'sonnet-5', 'sonnet-4-6'],
  )
})

test('a short catalog is left alone by the recent-models default', () => {
  const two = [model('opus-5'), model('sonnet-5')]
  assert.deepEqual(
    recentModels(two).map((m) => m.slug),
    ['opus-5', 'sonnet-5'],
  )
})

test('the default keeps the selection, in catalog order', () => {
  // A run pinned to an older model still names it, and it does not jump to
  // the top of the menu just because it survived.
  assert.deepEqual(
    visibleModels(CATALOG, undefined, 'haiku-4-5').map((m) => m.slug),
    ['opus-5', 'sonnet-5', 'sonnet-4-6', 'haiku-4-5'],
  )
})

test('models the default trims are reported as hidden, so the menu can reveal them', () => {
  assert.deepEqual(
    hiddenModelsIn(CATALOG, undefined).map((m) => m.slug),
    ['haiku-4-5'],
  )
})

test('the first hide/show click edits the list the default stands for', () => {
  // Without materializing, toggling a default-trimmed model would *add* it to
  // the hidden list — the opposite of the click.
  const explicit = materializeHiddenModels(CATALOG, undefined)
  assert.deepEqual(explicit, ['haiku-4-5'])
  assert.deepEqual(toggleHiddenModel(explicit, 'haiku-4-5'), [])

  // An existing curation is passed through untouched.
  assert.deepEqual(materializeHiddenModels(CATALOG, ['opus-5']), ['opus-5'])
  assert.deepEqual(materializeHiddenModels(CATALOG, []), [])
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
  assert.equal(modelKindForBin('/Applications/Codex'), 'codex')
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
