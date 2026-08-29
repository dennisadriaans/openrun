import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canRunUnattended,
  requiresGhAuth,
  sharedCheckoutMessage,
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
  it('a clean isolated worktree may fire', () => {
    assert.equal(unattendedBlockedReason(input()), null)
    assert.equal(canRunUnattended(input()), true)
  })

  it('the shared main checkout is refused, and named as the reason', () => {
    assert.equal(unattendedBlockedReason(input({ workspaceKind: 'main' })), sharedCheckoutMessage())
  })

  it('isolation is an opt-out, not a law', () => {
    assert.equal(
      unattendedBlockedReason(input({ workspaceKind: 'main', requireIsolation: false })),
      null,
    )
  })

  it('isolation outranks health — a shared checkout makes health meaningless', () => {
    const reason = unattendedBlockedReason(
      input({ workspaceKind: 'main', health: { ...healthy, code: 'dirty', dirty: true } }),
    )
    assert.equal(reason, sharedCheckoutMessage())
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
