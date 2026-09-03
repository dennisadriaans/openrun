import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canStartChat,
  emptyChatPromptMessage,
  missingRuntimeMessage,
  runtimeStartBlockedReason,
  startChatBlockedReason,
  workspaceBusyMessage,
  workspaceStartBlockedReason,
  type StartChatGateInput,
} from './startChatGate.ts'
import type { WorkspaceHealth } from './workspaceHealth.ts'

const health = (over: Partial<WorkspaceHealth> = {}): WorkspaceHealth => ({
  code: 'ok',
  path: '/tmp/ws',
  configuredBranch: 'feat/x',
  actualBranch: 'feat/x',
  dirty: false,
  detail: '',
  ...over,
})

const green = (over: Partial<StartChatGateInput> = {}): StartChatGateInput => ({
  workspaceValid: true,
  workspaceReady: true,
  workspaceStatus: 'ready',
  workspaceHealth: health(),
  activeRunId: null,
  runtimeValid: true,
  runtimeInstalled: true,
  runtimeBin: 'claude',
  promptValid: true,
  ...over,
})

test('a ready workspace, an installed runtime and a prompt may start', () => {
  assert.equal(startChatBlockedReason(green()), null)
  assert.equal(canStartChat(green()), true)
})

test('a missing workspace refuses before anything else is inspected', () => {
  const reason = startChatBlockedReason(
    green({ workspaceValid: false, runtimeInstalled: false, promptValid: false }),
  )
  assert.match(reason ?? '', /Pick a repository/)
})

test('a workspace that is not ready refuses with its lifecycle reason', () => {
  const reason = startChatBlockedReason(
    green({ workspaceReady: false, workspaceStatus: 'creating' }),
  )
  assert.match(reason ?? '', /still being set up/)
})

test('a workspace whose directory is gone refuses', () => {
  const reason = startChatBlockedReason(green({ workspaceHealth: health({ code: 'missing' }) }))
  assert.ok(reason)
})

test('a busy worktree refuses with the words assertWorkspaceFree throws', () => {
  assert.equal(startChatBlockedReason(green({ activeRunId: 'run_1' })), workspaceBusyMessage())
  // Whitespace is not a run.
  assert.equal(startChatBlockedReason(green({ activeRunId: '  ' })), null)
})

test('busy beats a runtime or prompt problem — the worktree is the harder no', () => {
  const reason = startChatBlockedReason(
    green({ activeRunId: 'run_1', runtimeInstalled: false, promptValid: false }),
  )
  assert.equal(reason, workspaceBusyMessage())
})

test('an unresolved runtime refuses before PATH is consulted', () => {
  assert.equal(
    startChatBlockedReason(green({ runtimeValid: false, runtimeInstalled: false })),
    missingRuntimeMessage(),
  )
})

test('a runtime off PATH names the binary', () => {
  const reason = startChatBlockedReason(green({ runtimeInstalled: false, runtimeBin: 'codex' }))
  assert.match(reason ?? '', /"codex" was not found on PATH/)
})

test('an empty first message is the last thing to refuse', () => {
  assert.equal(startChatBlockedReason(green({ promptValid: false })), emptyChatPromptMessage())
  assert.equal(canStartChat(green({ promptValid: false })), false)
})

test('the halves judge only their own row', () => {
  // A picker greys out the workspace, not the runtime, when the worktree is busy.
  assert.equal(workspaceStartBlockedReason(green({ activeRunId: 'run_1' })), workspaceBusyMessage())
  assert.equal(runtimeStartBlockedReason(green({ activeRunId: 'run_1' })), null)

  // …and the runtime, not the workspace, when the CLI is missing.
  assert.equal(workspaceStartBlockedReason(green({ runtimeInstalled: false })), null)
  assert.ok(runtimeStartBlockedReason(green({ runtimeInstalled: false })))
})

test('a dirty worktree is a human judgement call, not a refusal', () => {
  // Attended work in a tree with uncommitted changes is normal; only the
  // unattended gate treats contamination as fatal.
  assert.equal(
    startChatBlockedReason(green({ workspaceHealth: health({ code: 'dirty', dirty: true }) })),
    null,
  )
})
