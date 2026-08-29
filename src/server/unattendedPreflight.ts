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
import { requiresGhAuth, unattendedBlockedReason } from '../lib/unattendedGate.ts'
import type { WorkspaceHealth } from '../lib/workspaceHealth.ts'
import type { RuntimeRow, TaskRow, WorkspaceRow } from './db'
import { ghStatus } from './git'
import { checkWorkspace } from './workspaceHealth'

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
  const checked = checkWorkspace(task.workspaceId)
  if (!checked) return 'Automation workspace is not ready.'
  return unattendedRefusalFor({
    task,
    runtime,
    workspace: checked.workspace,
    health: checked.health,
  })
}
