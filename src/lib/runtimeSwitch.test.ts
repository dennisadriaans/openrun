import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isRuntimeSwitch,
  resolveSwitchMode,
  resolveSwitchModel,
  runtimeSwitchBlockedReason,
} from './runtimeSwitch.ts'
import { CLAUDE_MODELS, CODEX_MODELS } from './models.ts'

test('a switch needs two different, non-empty ids', () => {
  assert.equal(isRuntimeSwitch('claude', 'codex'), true)
  assert.equal(isRuntimeSwitch('claude', 'claude'), false)
  assert.equal(isRuntimeSwitch('', 'codex'), false)
  assert.equal(isRuntimeSwitch('claude', undefined), false)
})

test('a running turn blocks the switch', () => {
  assert.match(
    runtimeSwitchBlockedReason({ running: true, next: { label: 'Codex', installed: true } }) ?? '',
    /still working/,
  )
})

test('a runtime that is not on PATH blocks the switch', () => {
  assert.match(
    runtimeSwitchBlockedReason({ running: false, next: { label: 'Codex', installed: false } }) ??
      '',
    /not on PATH/,
  )
})

test('nothing blocks an installed target on an idle run', () => {
  assert.equal(
    runtimeSwitchBlockedReason({ running: false, next: { label: 'Codex', installed: true } }),
    null,
  )
  assert.equal(runtimeSwitchBlockedReason({ running: false }), null)
})

test('a cross-runtime model slug is dropped for the new default', () => {
  const claude = CLAUDE_MODELS[0]!
  const picked = resolveSwitchModel(CODEX_MODELS, claude.slug)
  assert.notEqual(picked.model, claude.slug)
  assert.ok(CODEX_MODELS.some((m) => m.slug === picked.model))
})

test('a slug the new runtime knows survives', () => {
  const codex = CODEX_MODELS[0]!
  assert.equal(resolveSwitchModel(CODEX_MODELS, codex.slug).model, codex.slug)
})

test('an empty catalog yields empty selections', () => {
  assert.deepEqual(resolveSwitchModel([], 'anything'), { model: '', effort: '' })
})

test('supervised falls back when the new runtime cannot ask', () => {
  assert.equal(
    resolveSwitchMode('approval-required', { bin: 'codex', transport: 'cli' }),
    'full-access',
  )
  assert.equal(
    resolveSwitchMode('approval-required', { bin: 'claude', transport: 'cli' }),
    'approval-required',
  )
  assert.equal(
    resolveSwitchMode('auto-accept-edits', { bin: 'codex', transport: 'cli' }),
    'auto-accept-edits',
  )
})
