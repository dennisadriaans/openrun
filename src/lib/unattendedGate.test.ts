import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canRunUnattended,
  requiresGhAuth,
  unattendedBlockedReason,
  workspaceOwnerMessage,
  type UnattendedGateInput,
} from './unattendedGate.ts'
import type { WorkspaceHealth } from './workspaceHealth.ts'

const healthy: WorkspaceHealth = {
  code: 'ok',
  path: '/tmp/wt/feature',
  configuredBranch: 'feature',
  actualBranch: 'feature',
  dirty: false,
  detail: '',
}

function input(over: Partial<UnattendedGateInput> = {}): UnattendedGateInput {
  return {
    workspaceKind: 'worktree',
    requireIsolation: true,
    health: healthy,
    requiresGh: false,
    ghInstalled: true,
    ghAuthenticated: true,
    ...over,
  }
}

describe('unattendedGate', () => {
  it('a saved conversation may retain edits but cannot bypass quarantine or a missing directory', () => {
    for (const code of ['dirty', 'branch-drift', 'detached'] as const) {
      assert.equal(
        unattendedBlockedReason(input({ resumeSessionId: 'saved', health: { ...healthy, code } })),
        null,
      )
    }
    for (const code of ['blocked', 'missing', 'not-a-worktree'] as const) {
      assert.ok(
        unattendedBlockedReason(input({ resumeSessionId: 'saved', health: { ...healthy, code } })),
      )
    }
  })
  it('a clean isolated worktree may fire', () => {
    assert.equal(unattendedBlockedReason(input()), null)
    assert.equal(canRunUnattended(input()), true)
  })

  it('a scheduled run may use the shared main checkout', () => {
    assert.equal(unattendedBlockedReason(input({ workspaceKind: 'main' })), null)
  })

  it('a dirty shared checkout is refused for a scheduled run', () => {
    const reason = unattendedBlockedReason(
      input({ workspaceKind: 'main', health: { ...healthy, code: 'dirty', dirty: true } }),
    )
    assert.match(reason ?? '', /uncommitted changes/i)
  })

  it('a webhook execution ignores source-checkout contamination', () => {
    assert.equal(
      unattendedBlockedReason(
        input({ freshExecution: true, health: { ...healthy, code: 'dirty', dirty: true } }),
      ),
      null,
    )
  })

  it('a contaminated worktree is refused even when isolated', () => {
    assert.ok(
      unattendedBlockedReason(
        input({ health: { ...healthy, code: 'branch-drift', actualBranch: 'main' } }),
      ),
    )
  })

  it('gh is preflighted only when the automation will actually reach for it', () => {
    assert.equal(unattendedBlockedReason(input({ ghAuthenticated: false })), null)
    assert.ok(unattendedBlockedReason(input({ requiresGh: true, ghAuthenticated: false })))
    assert.ok(unattendedBlockedReason(input({ requiresGh: true, ghInstalled: false })))
  })

  it('the PR capability implies the gh requirement', () => {
    assert.equal(requiresGhAuth({ canOpenPrs: true, requireGhAuth: false }), true)
    assert.equal(requiresGhAuth({ canOpenPrs: false, requireGhAuth: true }), true)
    assert.equal(requiresGhAuth({ canOpenPrs: false, requireGhAuth: false }), false)
  })

  it('gives a shared-worktree owner conflict an actionable next step', () => {
    assert.match(workspaceOwnerMessage('Nightly docs'), /Nightly docs/)
    assert.match(workspaceOwnerMessage('Nightly docs'), /own worktree/i)
  })
})
