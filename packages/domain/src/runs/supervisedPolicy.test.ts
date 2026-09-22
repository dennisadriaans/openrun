import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_TIMEOUT_MS,
  assertSupervisedAllowed,
  assertSupervisedSupported,
  isSupervised,
  supervisedAllowedForTrigger,
  supportsSupervised,
} from './supervisedPolicy.ts'

test('isSupervised only matches approval-required', () => {
  assert.equal(isSupervised('approval-required'), true)
  assert.equal(isSupervised('full-access'), false)
  assert.equal(isSupervised('auto-accept-edits'), false)
  assert.equal(isSupervised(undefined), false)
  assert.equal(isSupervised(null), false)
})

test('supervisedAllowedForTrigger blocks schedule and webhook', () => {
  assert.equal(supervisedAllowedForTrigger('schedule'), false)
  assert.equal(supervisedAllowedForTrigger('webhook'), false)
  assert.equal(supervisedAllowedForTrigger('manual'), true)
  assert.equal(supervisedAllowedForTrigger('planner'), true)
  assert.equal(supervisedAllowedForTrigger('chat'), true)
})

test('assertSupervisedAllowed throws for scheduled supervised runs', () => {
  assert.throws(
    () => assertSupervisedAllowed('schedule', 'approval-required'),
    /cannot run on a schedule or webhook/,
  )
})

test('assertSupervisedAllowed throws for webhook supervised runs', () => {
  assert.throws(
    () => assertSupervisedAllowed('webhook', 'approval-required'),
    /cannot run on a schedule or webhook/,
  )
})

test('assertSupervisedAllowed permits attended supervised and any non-supervised', () => {
  assert.doesNotThrow(() => assertSupervisedAllowed('manual', 'approval-required'))
  assert.doesNotThrow(() => assertSupervisedAllowed('chat', 'approval-required'))
  assert.doesNotThrow(() => assertSupervisedAllowed('schedule', 'full-access'))
  assert.doesNotThrow(() => assertSupervisedAllowed('schedule', 'auto-accept-edits'))
})

test('approval timeout is a sane positive duration', () => {
  assert.ok(APPROVAL_TIMEOUT_MS > 0)
})

test('supportsSupervised covers Claude CLI and every ACP runtime', () => {
  // Claude asks over its stdio control protocol.
  assert.equal(supportsSupervised({ bin: 'claude', transport: 'cli' }), true)
  // `codex exec` / headless grok decide from their own flags and never ask us.
  assert.equal(supportsSupervised({ bin: 'codex', transport: 'cli' }), false)
  assert.equal(supportsSupervised({ bin: 'grok', transport: 'cli' }), false)
  // ACP has session/request_permission, whoever the agent is.
  assert.equal(supportsSupervised({ bin: 'gemini', transport: 'acp' }), true)
  assert.equal(supportsSupervised({ bin: 'codex-acp', transport: 'acp' }), true)
  assert.equal(supportsSupervised({ bin: undefined }), false)
})

test('assertSupervisedSupported only fires for supervised runs it cannot serve', () => {
  // Not supervised — nothing to check.
  assert.doesNotThrow(() =>
    assertSupervisedSupported({ bin: 'codex', transport: 'cli', mode: 'full-access' }),
  )
  assert.doesNotThrow(() =>
    assertSupervisedSupported({ bin: 'claude', transport: 'cli', mode: 'approval-required' }),
  )
  assert.doesNotThrow(() =>
    assertSupervisedSupported({ bin: 'gemini', transport: 'acp', mode: 'approval-required' }),
  )
  assert.throws(
    () => assertSupervisedSupported({ bin: 'grok', transport: 'cli', mode: 'approval-required' }),
    /cannot pause for approvals/,
  )
})
