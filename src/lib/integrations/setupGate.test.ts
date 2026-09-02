import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canCreateIntegrationAutomation,
  integrationSetupBlockedReason,
  PICK_RUNTIME_MESSAGE,
  PICK_WORKSPACE_MESSAGE,
  type IntegrationSetupGateInput,
} from './setupGate.ts'
import { MAIN_CHECKOUT_AUTOMATION_MESSAGE } from '../pickWorkspace.ts'

const ready: IntegrationSetupGateInput = {
  workspaceId: 'ws_1',
  workspaceStatus: 'ready',
  workspaceKind: 'worktree',
  runtimeId: 'rt_1',
  runtimeInstalled: true,
  runtimeBin: 'claude',
  prompt: 'Implement the issue.',
  projectCheckCount: 1,
}

test('a ready worktree with an installed runtime may create', () => {
  assert.equal(integrationSetupBlockedReason(ready), null)
  assert.equal(canCreateIntegrationAutomation(ready), true)
})

test('each missing piece names itself, in the order the server checks', () => {
  assert.equal(
    integrationSetupBlockedReason({ ...ready, workspaceId: '  ' }),
    PICK_WORKSPACE_MESSAGE,
  )
  assert.match(
    integrationSetupBlockedReason({ ...ready, workspaceStatus: 'creating' }) ?? '',
    /still being set up/i,
  )
  assert.equal(integrationSetupBlockedReason({ ...ready, runtimeId: '' }), PICK_RUNTIME_MESSAGE)
  assert.match(
    integrationSetupBlockedReason({ ...ready, runtimeInstalled: false }) ?? '',
    /not found on PATH/i,
  )
  assert.match(integrationSetupBlockedReason({ ...ready, prompt: '   ' }) ?? '', /empty prompt/i)
})

/**
 * A webhook automation is unattended by definition, and `upsertTask` refuses
 * to arm one against a project with no definition of done.
 */
test('a project with no verification checks cannot be armed', () => {
  assert.match(
    integrationSetupBlockedReason({ ...ready, projectCheckCount: 0 }) ?? '',
    /at least one configured verification check/i,
  )
})

/**
 * `upsertTask` throws on the primary checkout, so offering Create there was a
 * button that could only fail — and a webhook writing into the branch the
 * editor has open is the failure that costs the most.
 */
test('the primary checkout is refused, not warned about', () => {
  assert.equal(
    integrationSetupBlockedReason({ ...ready, workspaceKind: 'main' }),
    MAIN_CHECKOUT_AUTOMATION_MESSAGE,
  )
})

/** A workspace that no longer resolves reads as "not found", not as ready. */
test('an unresolved workspace refuses rather than passing the ready check', () => {
  assert.match(
    integrationSetupBlockedReason({ ...ready, workspaceStatus: null }) ?? '',
    /not found/i,
  )
})
