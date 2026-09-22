import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isFatalHealth,
  isWorkspaceHealthy,
  workspaceHealthBlockedReason,
  workspaceHealthMessage,
  type WorkspaceHealth,
  type WorkspaceHealthCode,
} from './workspaceHealth.ts'

function health(code: WorkspaceHealthCode, extra: Partial<WorkspaceHealth> = {}): WorkspaceHealth {
  return {
    code,
    path: '/tmp/wt/feature',
    configuredBranch: 'feature',
    actualBranch: 'feature',
    dirty: false,
    detail: '',
    ...extra,
  }
}

describe('workspaceHealth', () => {
  it('only structural damage is fatal', () => {
    assert.equal(isFatalHealth('missing'), true)
    assert.equal(isFatalHealth('not-a-worktree'), true)
    assert.equal(isFatalHealth('dirty'), false)
    assert.equal(isFatalHealth('branch-drift'), false)
    assert.equal(isFatalHealth('blocked'), false)
    assert.equal(isFatalHealth('ok'), false)
  })

  it('an attended run is only refused by structural damage', () => {
    const attended = { unattended: false }
    assert.equal(workspaceHealthBlockedReason(health('ok'), attended), null)
    assert.equal(workspaceHealthBlockedReason(health('dirty', { dirty: true }), attended), null)
    assert.equal(
      workspaceHealthBlockedReason(health('branch-drift', { actualBranch: 'main' }), attended),
      null,
    )
    assert.ok(workspaceHealthBlockedReason(health('missing'), attended))
  })

  it('an unattended run is refused by every non-ok code', () => {
    const afk = { unattended: true }
    assert.equal(workspaceHealthBlockedReason(health('ok'), afk), null)
    for (const code of [
      'missing',
      'not-a-worktree',
      'detached',
      'branch-drift',
      'dirty',
      'blocked',
    ] as WorkspaceHealthCode[]) {
      assert.ok(workspaceHealthBlockedReason(health(code), afk), `${code} should refuse`)
    }
  })

  it('a null health blocks nothing — an unresolvable id is caught earlier', () => {
    assert.equal(workspaceHealthBlockedReason(null, { unattended: true }), null)
    assert.equal(isWorkspaceHealthy(null), false)
    assert.equal(isWorkspaceHealthy(health('ok')), true)
  })

  it('drift names both branches so the mismatch is readable', () => {
    const message = workspaceHealthMessage(
      health('branch-drift', { actualBranch: 'chore/bump', configuredBranch: 'main' }),
    )
    assert.ok(message.includes('chore/bump'))
    assert.ok(message.includes('main'))
  })

  it('a quarantine reports the recorded reason', () => {
    assert.equal(
      workspaceHealthMessage(health('blocked', { detail: 'left red by "nightly docs"' })),
      'left red by "nightly docs"',
    )
  })
})
