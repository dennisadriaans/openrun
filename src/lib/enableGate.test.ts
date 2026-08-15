import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { invalidCronMessage } from './cron.ts'
import { canEnableTask, enableBlockedReason } from './enableGate.ts'
import { missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { emptyTaskPromptMessage } from './taskPrompt.ts'
import { missingNativeSessionMessage } from './nativeSessions.ts'
import { missingWorkspaceMessage } from './workspaceRef.ts'
import { workspaceNotReadyMessage } from './workspaceReady.ts'

const healthy = {
  cron: '0 9 * * 1-5',
  cronValid: true,
  workspaceValid: true,
  workspaceReady: true,
  workspaceStatus: 'ready' as const,
  runtimeInstalled: true,
  runtimeBin: 'claude',
  promptValid: true,
}

describe('enableBlockedReason', () => {
  it('returns null when every arming gate is green', () => {
    assert.equal(enableBlockedReason(healthy), null)
    assert.equal(canEnableTask(healthy), true)
  })

  it('allows manual-only (empty cron) when the rest is healthy', () => {
    assert.equal(enableBlockedReason({ ...healthy, cron: '', cronValid: true }), null)
  })

  it('flags an invalid schedule first (same order as setTaskEnabled)', () => {
    const reason = enableBlockedReason({
      ...healthy,
      cron: 'every day',
      cronValid: false,
      workspaceValid: false,
      workspaceReady: false,
      runtimeInstalled: false,
      promptValid: false,
    })
    assert.equal(reason, invalidCronMessage('every day'))
    assert.equal(canEnableTask({ ...healthy, cronValid: false }), false)
  })

  it('flags a missing workspace before readiness / PATH', () => {
    const reason = enableBlockedReason({
      ...healthy,
      workspaceValid: false,
      workspaceReady: false,
      workspaceStatus: null,
      runtimeInstalled: false,
      promptValid: false,
    })
    assert.equal(reason, missingWorkspaceMessage())
  })

  it('flags a non-ready workspace with the lifecycle message', () => {
    assert.equal(
      enableBlockedReason({
        ...healthy,
        workspaceReady: false,
        workspaceStatus: 'creating',
      }),
      workspaceNotReadyMessage('creating'),
    )
    assert.equal(
      enableBlockedReason({
        ...healthy,
        workspaceReady: false,
        workspaceStatus: 'error',
      }),
      workspaceNotReadyMessage('error'),
    )
  })

  it('flags a missing runtime binary before an empty prompt', () => {
    assert.equal(
      enableBlockedReason({
        ...healthy,
        runtimeInstalled: false,
        runtimeBin: 'codex',
        promptValid: false,
      }),
      missingRuntimeBinaryMessage('codex'),
    )
  })

  it('uses empty-binary copy when the runtime row has no bin name', () => {
    assert.equal(
      enableBlockedReason({
        ...healthy,
        runtimeInstalled: false,
        runtimeBin: '',
      }),
      missingRuntimeBinaryMessage(''),
    )
  })

  it('flags an empty prompt before a missing native chat', () => {
    assert.equal(enableBlockedReason({ ...healthy, promptValid: false }), emptyTaskPromptMessage())
    assert.equal(canEnableTask({ ...healthy, promptValid: false }), false)
  })

  it('flags a missing native Claude chat last', () => {
    assert.equal(
      enableBlockedReason({
        ...healthy,
        resumeSessionId: 'sess-1',
        resumeSessionValid: false,
      }),
      missingNativeSessionMessage(),
    )
  })
})
