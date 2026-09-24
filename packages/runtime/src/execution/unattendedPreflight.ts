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
import { automationBaseRefusal } from './runEnvironment.ts'
import { usesFreshExecution } from '@openrun/domain/runs/executionWorkspace'
import {
  requiresGhAuth,
  unattendedBlockedReason,
  workspaceOwnerMessage,
} from '@openrun/domain/tasks/unattendedGate'
import {
  missingProjectChecksMessage,
  verificationDisabledMessage,
} from '@openrun/domain/runs/checks'
import { hasTaskPrompt } from '@openrun/domain/tasks/taskPrompt'
import { hasWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import { isWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import {
  missingNativeSessionMessage,
  nativeResumeKindFor,
} from '@openrun/domain/runtimes/nativeSessions'
import type { WorkspaceHealth } from '@openrun/domain/workspaces/workspaceHealth'
import type { RuntimeRow, TaskRow, WorkspaceRow } from '../storage/db.ts'
import { ghStatus } from '../workspaces/git.ts'
import { checkRuntimeInstalled } from '../runtimes/runtimePath.ts'
import { nativeSessionExists } from '../runtimes/nativeSessions.ts'
import { checksForWorkspace } from './checks.ts'
import { checkWorkspace } from '../workspaces/workspaceHealth.ts'
import { getUnattendedWorkspaceOwner } from '../workspaces/workspaces.ts'

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
export type UnattendedPolicy = Pick<TaskRow, 'requireIsolation' | 'requireGhAuth' | 'baseRef'> & {
  resumeSessionId?: string
  fireOnce?: number
}

/** Reason an unattended fire is unsafe, given an already-inspected workspace. */
export function unattendedRefusalFor(input: {
  task: UnattendedPolicy
  runtime: RuntimeRow
  workspace: WorkspaceRow
  health: WorkspaceHealth
  trigger?: 'schedule' | 'webhook'
}): string | null {
  const fresh = usesFreshExecution({
    trigger: input.trigger ?? 'schedule',
    resumeSessionId: input.task.resumeSessionId,
  })
  if (fresh) {
    const baseRefusal = automationBaseRefusal(input.workspace.id, input.task.baseRef)
    if (baseRefusal) return baseRefusal
  }
  const gh = ghStatus()
  return unattendedBlockedReason({
    freshExecution: fresh,
    workspaceKind: input.workspace.kind,
    requireIsolation: input.task.requireIsolation === 1,
    fireOnce: input.task.fireOnce === 1,
    health: input.health,
    resumeSessionId: input.task.resumeSessionId,
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
export function unattendedRefusal(
  task: TaskRow,
  runtime: RuntimeRow,
  trigger: 'schedule' | 'webhook' = 'schedule',
): string | null {
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

  const sessionId = usesFreshExecution({ trigger, resumeSessionId: task.resumeSessionId })
    ? ''
    : task.resumeSessionId.trim()
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
    trigger,
  })
}
