import assert from 'node:assert/strict'
import { test } from 'node:test'
import { modelsForKind, type ModelOption } from '../../src/lib/models.ts'
import { catalogFromDiscovered, parseGeminiModelsModule } from '../../src/lib/modelDiscovery.ts'
import {
  interpreterModels,
  NATIVE_RUNTIMES,
  resolveNativeEffort,
  type NativeCatalog,
  type NativeRuntime,
} from './agentSelection.ts'
import {
  parseLocalAgent,
  parseLocalRequest,
  readInterpretation,
  resolveNativeModel,
} from './natural.ts'
import { nativeArgs } from './native.ts'

const catalogs: NativeCatalog[] = (Object.keys(NATIVE_RUNTIMES) as NativeRuntime[]).map(
  (runtime) => ({ runtime, models: modelsForKind(runtime) }),
)

test('reported model names resolve with spaces, casing and the Haiku spelling correction', () => {
  const examples = [
    ['gpt 5.5', 'codex', 'gpt-5.5', 'high'],
    ['LUNA', 'codex', 'gpt-5.6-luna', 'max'],
    ['Terra', 'codex', 'gpt-5.6-terra', 'ultra'],
    ['Sol', 'codex', 'gpt-5.6-sol', 'low'],
    ['Astra', 'codex', 'gpt-6-astra', 'ultra'],
    ['Heiku', 'claude', 'claude-haiku-4-5', 'default'],
    ['sonnet', 'claude', 'claude-sonnet-5', 'low'],
    ['opus', 'claude', 'claude-opus-5', 'xhigh'],
    ['fable', 'claude', 'claude-fable-5-1', 'max'],
    ['Grok 4.7', 'grok', 'grok-4.7', 'high'],
  ]
  for (const [name, runtime, slug, effort] of examples) {
    const request = `create new file x.html ${name} ${effort}`
    const parsed = parseLocalRequest([request], catalogs, 'auto')
    assert.ok(parsed, request)
    assert.equal(parsed.intent.runtimeHint, runtime)
    assert.equal(parsed.intent.modelHint, slug)
    assert.equal(parsed.intent.effortHint, effort === 'default' ? '' : effort)
    assert.equal(parsed.intent.prompt, 'create new file x.html')
  }
})

test('every catalog model and effort can be selected with an explicit runtime', () => {
  for (const { runtime, models } of catalogs) {
    for (const model of models) {
      for (const effort of model.efforts.length ? model.efforts : [{ value: '' }]) {
        const request = `create new file x.html using ${runtime} ${model.slug} ${effort.value || 'default'}`
        const parsed = parseLocalRequest([request], catalogs, 'auto')
        assert.ok(parsed, request)
        assert.equal(parsed.intent.runtimeHint, runtime, request)
        assert.equal(parsed.intent.modelHint, model.slug, request)
        assert.equal(parsed.intent.effortHint, effort.value, request)
        assert.equal(parsed.intent.prompt, 'create new file x.html', request)
      }
    }
  }
})

test('effort labels normalize while unavailable levels remain visible for validation', () => {
  for (const label of ['extra high', 'extra-high', 'XHIGH', 'with extra high reasoning effort']) {
    const parsed = parseLocalRequest([`create a file Astra ${label}`], catalogs, 'auto')
    assert.equal(parsed?.intent.effortHint, 'xhigh', label)
    assert.equal(parsed?.intent.prompt, 'create a file', label)
  }
  assert.equal(resolveNativeEffort('maximum', modelsForKind('codex')), 'max')
  const parsed = parseLocalRequest(['create a file Luna ultra'], catalogs, 'auto')
  const model = resolveNativeModel(parsed!.intent.modelHint, modelsForKind('codex'))!
  assert.equal(parsed?.intent.effortHint, 'ultra')
  assert.equal(
    model.efforts.some((effort) => effort.value === 'ultra'),
    false,
  )
})

test('gateways do not steal model nicknames from the native runtime', () => {
  assert.equal(parseLocalAgent(['using sonnet low'], catalogs).selection?.runtime, 'claude')
  assert.equal(
    parseLocalAgent(['using agy sonnet low'], catalogs).selection?.runtime,
    'antigravity',
  )
  for (const text of [
    'write a sonnet',
    'write "grok"',
    'write a file containing "using" "Sol" "low"',
  ])
    assert.equal(parseLocalAgent([text], catalogs).selection, undefined, text)
})

test('an explicit gateway selects its own model regardless of control order', () => {
  for (const controls of ['agy low sonnet', 'sonnet low agy', 'low sonnet agy']) {
    const result = parseLocalRequest([`create a file ${controls}`], catalogs, 'auto')
    const model = resolveNativeModel('sonnet', modelsForKind('antigravity'))
    assert.equal(result?.intent.runtimeHint, 'antigravity')
    assert.equal(result?.intent.modelHint, model?.slug)
    assert.equal(result?.intent.effortHint, 'low')
    assert.equal(result?.intent.prompt, 'create a file')
  }
})

test('newly discovered families and named models beyond the catalog limit stay selectable', () => {
  const models: ModelOption[] = Array.from({ length: 90 }, (_, index) => ({
    slug: `vendor/model-${index}`,
    name: `Model ${index}`,
    shortName: `Model ${index}`,
    provider: 'fx',
    efforts: [],
  }))
  const fable = {
    ...modelsForKind('claude')[0]!,
    slug: 'claude-fable-6',
    name: 'Fable 6',
    shortName: 'Fable 6',
  }
  const available: NativeCatalog[] = [
    ...catalogs.filter((row) => row.runtime !== 'fx'),
    { runtime: 'fx', models },
  ]
  assert.equal(resolveNativeModel('fable', [fable])?.slug, fable.slug)
  const choices = interpreterModels(available, 'review the code using fx vendor/model-89')
  assert.ok(choices.some((model) => model.slug === 'vendor/model-89'))
  assert.ok(choices.length <= 60)
  assert.ok(new TextEncoder().encode(JSON.stringify(choices)).length <= 16_002)
  for (const runtime of Object.keys(NATIVE_RUNTIMES))
    assert.ok(
      choices.some((model) => model.runtime === runtime),
      runtime,
    )
})

test('runtime-only requests and hosted responses admit every supported runtime', () => {
  for (const runtime of Object.keys(NATIVE_RUNTIMES) as NativeRuntime[]) {
    assert.equal(parseLocalRequest([runtime], catalogs, 'auto')?.intent.runtimeHint, runtime)
    const result = readInterpretation(
      {
        version: 1,
        action: 'launch',
        runtime,
        model: '',
        effort: '',
        prompt: null,
        schedule: null,
        openPr: false,
        clarify: [],
      },
      runtime,
      'auto',
    )
    assert.equal(result.intent.runtimeHint, runtime)
  }
})

test('runtime flags apply Grok effort, interactive prompts and opt-in prompt effort correctly', () => {
  const base = { model: '', effort: '', prompt: 'create x.html', cwd: '/repo' }
  assert.deepEqual(nativeArgs({ ...base, runtime: 'grok', model: 'grok-4.7', effort: 'high' }), [
    '--model',
    'grok-4.7',
    '--reasoning-effort',
    'high',
    '--',
    base.prompt,
  ])
  for (const runtime of ['gemini', 'antigravity'] as const)
    assert.deepEqual(nativeArgs({ ...base, runtime }), ['--prompt-interactive', base.prompt])
  assert.throws(
    () => nativeArgs({ ...base, runtime: 'gemini', effort: 'high' }),
    /no reasoning effort flag/,
  )
  assert.deepEqual(nativeArgs({ ...base, runtime: 'fx', model: 'vendor/model' }), [
    'ask',
    '--model',
    'vendor/model',
    '--',
    base.prompt,
  ])
  assert.deepEqual(
    nativeArgs({ ...base, runtime: 'claude', model: 'claude-future-6', effort: 'ultrathink' }),
    ['--model', 'claude-future-6', '--', `Ultrathink:\n${base.prompt}`],
  )
})

test('Gemini discovery includes current models and aliases without embedding models or effort flags', () => {
  const models = catalogFromDiscovered(
    'gemini',
    parseGeminiModelsModule(`
    export const PREVIEW_GEMINI_3_1_MODEL = 'gemini-3.1-pro-preview';
    export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
    export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
    export const GEMINI_MODEL_ALIAS_FLASH = 'flash';
    export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
  `),
  )
  assert.equal(models[0]?.slug, 'auto')
  assert.ok(models.some((model) => model.slug === 'gemini-3.1-pro-preview'))
  assert.equal(resolveNativeModel('Gemini Flash', models)?.slug, 'flash')
  assert.equal(
    models.some((model) => model.slug.includes('embedding')),
    false,
  )
  assert.ok(models.every((model) => model.efforts.length === 0))
})
