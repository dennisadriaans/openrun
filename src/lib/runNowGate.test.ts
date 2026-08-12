import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { canRunTaskNow, runNowBlockedReason } from './runNowGate.ts'
import { missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { emptyTaskPromptMessage } from './taskPrompt.ts'
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

describe('runNowBlockedReason', () => {
  it('returns null when every run gate is green', () => {
    assert.equal(runNowBlockedReason(healthy), null)
    assert.equal(canRunTaskNow(healthy), true)
  })

  it('flags a missing workspace before readiness / PATH', () => {
    const reason = runNowBlockedReason({
      ...healthy,
      workspaceValid: false,
      workspaceReady: false,
      workspaceStatus: null,
      runtimeInstalled: false,
      promptValid: false,
    })
    assert.equal(reason, missingWorkspaceMessage())
    assert.equal(canRunTaskNow({ ...healthy, workspaceValid: false }), false)
  })

  it('flags a non-ready workspace with the lifecycle message', () => {
    assert.equal(
      runNowBlockedReason({
        ...healthy,
        workspaceReady: false,
        workspaceStatus: 'creating',
      }),
      workspaceNotReadyMessage('creating'),
    )
    assert.equal(
      runNowBlockedReason({
        ...healthy,
        workspaceReady: false,
        workspaceStatus: 'error',
      }),
      workspaceNotReadyMessage('error'),
    )
  })

  it('flags a missing runtime binary before an empty prompt', () => {
    assert.equal(
      runNowBlockedReason({
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
      runNowBlockedReason({
        ...healthy,
        runtimeInstalled: false,
        runtimeBin: '',
      }),
      missingRuntimeBinaryMessage(''),
    )
  })

  it('flags an empty prompt last', () => {
    assert.equal(
      runNowBlockedReason({ ...healthy, promptValid: false }),
      emptyTaskPromptMessage(),
    )
    assert.equal(canRunTaskNow({ ...healthy, promptValid: false }), false)
  })

  it('does not block on cron — invalid schedules still allow Run now', () => {
    // Gate input has no cron fields; this documents the intentional omission.
    assert.equal(runNowBlockedReason(healthy), null)
  })
})
