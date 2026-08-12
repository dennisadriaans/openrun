import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RUNTIME_PRESETS, compareRuntimesForDisplay, runtimeSortRank } from './runtimePresets.ts'

const row = (id: string, createdAt: number) => ({ id, createdAt })

test('builtin runtimes rank in preset order', () => {
  const ranks = RUNTIME_PRESETS.map((p) => runtimeSortRank(p.id))
  assert.deepEqual(ranks, RUNTIME_PRESETS.map((_, i) => i))
})

test('unknown runtimes rank after every builtin', () => {
  assert.ok(runtimeSortRank('my-custom-cli') >= RUNTIME_PRESETS.length)
})

test('preset order wins over createdAt for builtins', () => {
  // The macOS repro: gemini was seeded long before the other builtins were
  // backfilled, so createdAt ordering floated it above Claude Code.
  const rows = [row('gemini', 1), row('claude', 2), row('codex', 2), row('gemini-acp', 3)]
  const sorted = [...rows].sort(compareRuntimesForDisplay).map((r) => r.id)
  assert.deepEqual(sorted, ['claude', 'codex', 'gemini', 'gemini-acp'])
})

test('a freshly seeded DB and a backfilled DB order identically', () => {
  const fresh = RUNTIME_PRESETS.map((p) => row(p.id, 100))
  const backfilled = [
    row('gemini', 1),
    ...RUNTIME_PRESETS.filter((p) => p.id !== 'gemini').map((p) => row(p.id, 500)),
  ]
  assert.deepEqual(
    [...fresh].sort(compareRuntimesForDisplay).map((r) => r.id),
    [...backfilled].sort(compareRuntimesForDisplay).map((r) => r.id),
  )
})

test('user-added runtimes keep createdAt order among themselves', () => {
  const rows = [row('zeta-cli', 20), row('alpha-cli', 10), row('claude', 99)]
  const sorted = [...rows].sort(compareRuntimesForDisplay).map((r) => r.id)
  assert.deepEqual(sorted, ['claude', 'alpha-cli', 'zeta-cli'])
})
