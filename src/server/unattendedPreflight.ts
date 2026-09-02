/**
 * The one place a scheduled, queued or webhook-triggered fire is checked
 * against the AFK rules before an agent is spawned.
 *
 * Three entry points can start an unattended run — `scheduler.fireTask`,
 * `runQueue.drainWorkspace` and the webhook dispatcher — and each of them used
 * to carry its own idea of what "ready" meant. They now share this, so an
 * automation cannot be refused by one path and armed by another.
 *
 * The rules themselves live in `lib/unattendedGate.ts`; this module only does
 * the lookups those rules need.
 */
import {
  requiresGhAuth,
  unattendedBlockedReason,
  workspaceOwnerMessage,
} from '../lib/unattendedGate.ts'
import { missingProjectChecksMessage, verificationDisabledMessage } from '../lib/checks.ts'
import { hasTaskPrompt } from '../lib/taskPrompt.ts'
import { hasWorkspaceId } from '../lib/workspaceRef.ts'
import { isWorkspaceReady } from '../lib/workspaceReady.ts'
import { missingNativeSessionMessage, nativeResumeKindFor } from '../lib/nativeSessions.ts'
import type { WorkspaceHealth } from '../lib/workspaceHealth.ts'
import type { RuntimeRow, TaskRow, WorkspaceRow } from './db'
import { ghStatus } from './git'
import { checkRuntimeInstalled } from './runtimePath.ts'
import { nativeSessionExists } from './nativeSessions.ts'
import { checksForWorkspace } from './checks.ts'
import { checkWorkspace } from './workspaceHealth'
import { getUnattendedWorkspaceOwner } from './workspaces.ts'

/** Shared mutation/fire error so an automation cannot be armed unverified. */
export function unattendedVerificationRefusal(input: {
  workspaceId: string
  verifyEnabled: number | boolean
}): string | null {
  if (!input.verifyEnabled) return verificationDisabledMessage()
  if (checksForWorkspace(input.workspaceId).length === 0) {
    return missingProjectChecksMessage()
  }
  return null
}

/** The two automation columns the AFK rules read. */
export type UnattendedPolicy = Pick<TaskRow, 'requireIsolation' | 'requireGhAuth'>

/** Reason an unattended fire is unsafe, given an already-inspected workspace. */
export function unattendedRefusalFor(input: {
  task: UnattendedPolicy
  runtime: RuntimeRow
  workspace: WorkspaceRow
  health: WorkspaceHealth
}): string | null {
  const gh = ghStatus()
  return unattendedBlockedReason({
    workspaceKind: input.workspace.kind,
    requireIsolation: input.task.requireIsolation === 1,
    health: input.health,
    requiresGh: requiresGhAuth({
      canOpenPrs: input.runtime.canOpenPrs === 1,
      requireGhAuth: input.task.requireGhAuth === 1,
    }),
    ghInstalled: gh.installed,
    ghAuthenticated: gh.authenticated,
  })
}

/**
 * Inspect the task's workspace and apply the AFK rules in one call, for
 * callers that do not already hold a health result. Returns the reason to
 * refuse, or `null` to proceed.
 */
export function unattendedRefusal(task: TaskRow, runtime: RuntimeRow): string | null {
  if (!hasWorkspaceId(task.workspaceId)) return `Task ${task.id} has no workspace`
  const verificationRefusal = unattendedVerificationRefusal({
    workspaceId: task.workspaceId,
    verifyEnabled: task.verifyEnabled,
  })
  if (verificationRefusal) return verificationRefusal
  const checked = checkWorkspace(task.workspaceId)
  if (!checked) return 'Automation workspace is not ready.'
  if (!isWorkspaceReady(checked.workspace.status)) return 'Automation workspace is not ready.'
  if (!checkRuntimeInstalled(runtime.bin).installed) return 'Automation runtime is not on PATH.'
  if (!hasTaskPrompt(task.prompt)) return 'Automation has empty agent instructions.'

  const sessionId = task.resumeSessionId.trim()
  if (sessionId) {
    const kind = nativeResumeKindFor(runtime)
    if (!kind) return 'The selected runtime does not support resuming a conversation.'
    if (!nativeSessionExists(checked.workspace.path, kind, sessionId)) {
      return missingNativeSessionMessage(kind)
    }
  }

  const owner = getUnattendedWorkspaceOwner(task.workspaceId, task.id)
  if (owner) return workspaceOwnerMessage(owner.name)

  return unattendedRefusalFor({
    task,
    runtime,
    workspace: checked.workspace,
    health: checked.health,
  })
}
