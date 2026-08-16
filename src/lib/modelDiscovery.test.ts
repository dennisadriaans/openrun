import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogFromDiscovered,
  parseAgyModelsOutput,
  parseClaudeBundleModels,
  parseGrokModelsOutput,
} from './modelDiscovery.ts'

/** Trimmed to the shape the real bundle uses; field order matches it. */
const CLAUDE_BUNDLE = `
var catalog={models:[{id:"claude-3-5-sonnet",family:"sonnet",display_name:"Sonnet 3.5",provider_ids:{first_party:"claude-3-5-sonnet-20241022"},capabilities:[],image_limits:{}},{id:"claude-haiku-4-5",family:"haiku",display_name:"Haiku 4.5",knowledge_cutoff:"February 2025",provider_ids:{first_party:"claude-haiku-4-5-20251001"},capabilities:["context_management"],advisor_rank:1},{id:"claude-sonnet-5",family:"sonnet",display_name:"Sonnet 5",provider_ids:{first_party:"claude-sonnet-5"},capabilities:["effort","max_effort","xhigh_effort","adaptive_thinking"],default_effort:"high",advisor_rank:3},{id:"claude-opus-5",family:"opus",display_name:"Opus 5",provider_ids:{first_party:"claude-opus-5"},capabilities:["effort","max_effort","xhigh_effort"],default_effort:"high",advisor_rank:4}],aliases:{opus:{default:"claude-opus-5"}},latest_per_family:{opus:"claude-opus-5",sonnet:"claude-sonnet-5",haiku:"claude-haiku-4-5"}};
`

test('claude bundle scan finds current models and their real efforts', () => {
  const models = parseClaudeBundleModels(CLAUDE_BUNDLE)
  const bySlug = new Map(models.map((m) => [m.slug, m]))

  assert.deepEqual(bySlug.get('claude-opus-5')?.efforts, ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(bySlug.get('claude-opus-5')?.defaultEffort, 'high')
  assert.equal(bySlug.get('claude-opus-5')?.rank, 4)
  assert.equal(bySlug.get('claude-sonnet-5')?.name, 'Sonnet 5')
})

test('claude bundle scan keeps latest-per-family even without effort support', () => {
  const models = parseClaudeBundleModels(CLAUDE_BUNDLE)
  const haiku = models.find((m) => m.slug === 'claude-haiku-4-5')
  assert.ok(haiku, 'haiku is the latest of its family')
  // No `effort` capability — sending `--effort` would be rejected by the CLI.
  assert.deepEqual(haiku.efforts, [])
})

test('claude bundle scan drops superseded ids so the picker stays short', () => {
  const models = parseClaudeBundleModels(CLAUDE_BUNDLE)
  assert.equal(
    models.some((m) => m.slug === 'claude-3-5-sonnet'),
    false,
  )
})

test('claude bundle scan yields nothing rather than guessing on a changed bundle', () => {
  assert.deepEqual(parseClaudeBundleModels('var catalog={models:[]};'), [])
})

test('claude catalog shaping adds our prompt-injected efforts', () => {
  const catalog = catalogFromDiscovered('claude', parseClaudeBundleModels(CLAUDE_BUNDLE))
  const opus = catalog.find((m) => m.slug === 'claude-opus-5')
  assert.ok(opus)
  assert.equal(opus.efforts.find((e) => e.isDefault)?.value, 'high')
  assert.ok(opus.efforts.some((e) => e.value === 'ultracode'))
  assert.ok(opus.efforts.some((e) => e.value === 'ultrathink' && e.promptInjected))

  // The CLI's own `opus` alias leads, so `defaultModel()` preselects the model
  // a bare `claude` invocation would have used.
  assert.equal(catalog[0]?.slug, 'claude-opus-5')

  const haiku = catalog.find((m) => m.slug === 'claude-haiku-4-5')
  assert.deepEqual(
    haiku?.efforts.map((e) => e.value),
    ['ultrathink'],
  )
})

const AGY_OUTPUT = `Fetching available models...
gemini-3.1-pro-high\tGemini 3.1 Pro (High)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
`

test('agy models output parses id/name pairs', () => {
  const models = parseAgyModelsOutput(AGY_OUTPUT)
  assert.equal(models.length, 2)
  assert.equal(models[0]?.slug, 'gemini-3.1-pro-high')
  assert.equal(models[0]?.name, 'Gemini 3.1 Pro (High)')
})

test('agy ids that bake in effort get no effort flag', () => {
  const models = parseAgyModelsOutput(AGY_OUTPUT)
  assert.deepEqual(models.find((m) => m.slug === 'gemini-3.1-pro-high')?.efforts, [])
  assert.deepEqual(models.find((m) => m.slug === 'claude-sonnet-4-6')?.efforts, [
    'low',
    'medium',
    'high',
  ])
})

test('agy shaping shortens the composer label', () => {
  const catalog = catalogFromDiscovered('antigravity', parseAgyModelsOutput(AGY_OUTPUT))
  assert.equal(catalog[0]?.shortName, 'Gemini 3.1 Pro')
  assert.equal(catalog[0]?.provider, 'antigravity')
})

test('shortening keeps the qualifier when it is the only thing distinguishing models', () => {
  const catalog = catalogFromDiscovered(
    'antigravity',
    parseAgyModelsOutput(
      'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\ngemini-3.7-flash-low\tGemini 3.7 Flash (Low)\n',
    ),
  )
  assert.deepEqual(
    catalog.map((m) => m.shortName),
    ['Gemini 3.7 Flash (High)', 'Gemini 3.7 Flash (Low)'],
  )
})

const GROK_OUTPUT = `You are not authenticated.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
`

test('grok models output parses the bulleted list and ranks the default first', () => {
  const catalog = catalogFromDiscovered('grok', parseGrokModelsOutput(GROK_OUTPUT))
  assert.deepEqual(
    catalog.map((m) => m.slug),
    ['grok-4.6', 'grok-4.5'],
  )
  assert.equal(catalog[0]?.name, 'Grok 4.6')
})

test('grok parse ignores prose lines around the list', () => {
  assert.equal(
    parseGrokModelsOutput('You are not authenticated.\n\nDefault model: grok-4.6\n').length,
    0,
  )
})

test('same-tier models sort newest version first', () => {
  const tier = [
    { slug: 'claude-opus-4-7', name: 'Opus 4.7', efforts: [], defaultEffort: '', rank: 4 },
    { slug: 'claude-opus-5', name: 'Opus 5', efforts: [], defaultEffort: '', rank: 4 },
    { slug: 'claude-opus-4-8', name: 'Opus 4.8', efforts: [], defaultEffort: '', rank: 4 },
  ]
  assert.deepEqual(
    catalogFromDiscovered('claude', tier).map((m) => m.slug),
    ['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7'],
  )
})

test('catalog shaping drops duplicate slugs', () => {
  const dupe = [
    { slug: 'a', name: 'A', efforts: [], defaultEffort: '', rank: 1 },
    { slug: 'a', name: 'A again', efforts: [], defaultEffort: '', rank: 9 },
  ]
  assert.equal(catalogFromDiscovered('grok', dupe).length, 1)
})
