import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { runPrereqBlockedReason, workspaceBlockedReason } from './runPrereqGate.ts'
import { emptyTaskPromptMessage } from './taskPrompt.ts'
import { missingNativeSessionMessage } from './nativeSessions.ts'
import { missingWorkspaceMessage } from './workspaceRef.ts'
import { workspaceNotReadyMessage } from './workspaceReady.ts'

const healthy = {
  workspaceValid: true,
  workspaceReady: true,
  workspaceStatus: 'ready' as const,
  runtimeInstalled: true,
  runtimeBin: 'claude',
  promptValid: true,
}

describe('workspaceBlockedReason', () => {
  it('returns null when the workspace exists and is ready', () => {
    assert.equal(
      workspaceBlockedReason({
        workspaceValid: true,
        workspaceReady: true,
        workspaceStatus: 'ready',
      }),
      null,
    )
  })

  it('flags a missing workspace before readiness', () => {
    assert.equal(
      workspaceBlockedReason({
        workspaceValid: false,
        workspaceReady: false,
        workspaceStatus: null,
      }),
      missingWorkspaceMessage(),
    )
  })

  it('flags a non-ready workspace with the lifecycle message', () => {
    assert.equal(
      workspaceBlockedReason({
        workspaceValid: true,
        workspaceReady: false,
        workspaceStatus: 'creating',
      }),
      workspaceNotReadyMessage('creating'),
    )
  })
})

describe('runPrereqBlockedReason', () => {
  it('returns null when every run gate is green', () => {
    assert.equal(runPrereqBlockedReason(healthy), null)
  })

  it('flags workspace before PATH and prompt', () => {
    assert.equal(
      runPrereqBlockedReason({
        ...healthy,
        workspaceValid: false,
        workspaceReady: false,
        runtimeInstalled: false,
        promptValid: false,
      }),
      missingWorkspaceMessage(),
    )
  })

  it('flags PATH before an empty prompt', () => {
    assert.equal(
      runPrereqBlockedReason({
        ...healthy,
        runtimeInstalled: false,
        runtimeBin: 'codex',
        promptValid: false,
      }),
      missingRuntimeBinaryMessage('codex'),
    )
  })

  it('flags an empty prompt before a missing native chat', () => {
    assert.equal(
      runPrereqBlockedReason({ ...healthy, promptValid: false }),
      emptyTaskPromptMessage(),
    )
  })

  it('flags a missing native Claude chat last', () => {
    assert.equal(
      runPrereqBlockedReason({
        ...healthy,
        resumeSessionId: 'sess-1',
        resumeSessionValid: false,
      }),
      missingNativeSessionMessage(),
    )
  })

  it('ignores resumeSessionValid when no native session is bound', () => {
    assert.equal(
      runPrereqBlockedReason({ ...healthy, resumeSessionId: '', resumeSessionValid: false }),
      null,
    )
  })
})
