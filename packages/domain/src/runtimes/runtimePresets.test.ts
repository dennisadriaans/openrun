import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RUNTIME_PRESETS, compareRuntimesForDisplay, runtimeSortRank } from './runtimePresets.ts'

const row = (id: string, createdAt: number) => ({ id, createdAt })

test('builtin runtimes rank in preset order', () => {
  const ranks = RUNTIME_PRESETS.map((p) => runtimeSortRank(p.id))
  assert.deepEqual(
    ranks,
    RUNTIME_PRESETS.map((_, i) => i),
  )
})

test('unknown runtimes rank after every builtin', () => {
  assert.ok(runtimeSortRank('my-custom-cli') >= RUNTIME_PRESETS.length)
})

test('preset order wins over createdAt for builtins', () => {
  // The macOS repro: one builtin was seeded long before the others were
  // backfilled, so createdAt ordering floated it above Claude Code.
  const rows = [row('fx', 1), row('claude', 2), row('codex', 2), row('my-custom-cli', 3)]
  const sorted = [...rows].sort(compareRuntimesForDisplay).map((r) => r.id)
  assert.deepEqual(sorted, ['claude', 'codex', 'fx', 'my-custom-cli'])
})

test('a freshly seeded DB and a backfilled DB order identically', () => {
  // Pin the oldest row to a real preset — an id that is not a builtin sorts
  // after every builtin instead, which would not exercise preset order at all.
  const oldest = RUNTIME_PRESETS[RUNTIME_PRESETS.length - 1]!.id
  const fresh = RUNTIME_PRESETS.map((p) => row(p.id, 100))
  const backfilled = [
    row(oldest, 1),
    ...RUNTIME_PRESETS.filter((p) => p.id !== oldest).map((p) => row(p.id, 500)),
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

test('fx ships as an ACP builtin', () => {
  const fx = RUNTIME_PRESETS.find((p) => p.id === 'fx')
  assert.equal(fx?.bin, 'fx')
  assert.equal(fx?.transport, 'acp')
  assert.deepEqual(fx?.argsTemplate, ['acp'])
  assert.equal(fx?.promptViaStdin, false)
})
