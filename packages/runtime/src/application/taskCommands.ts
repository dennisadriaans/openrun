/** taskCommands capability implementation. */
import { automationBaseRefusal } from '../execution/runEnvironment.ts'
import { normalizeCron } from '@openrun/domain/tasks/cron'
import { assertRunTimeoutMinutes } from '@openrun/domain/runs/runBudget'
import { assertTaskPrompt } from '@openrun/domain/tasks/taskPrompt'
import { clampRepairAttempts } from '@openrun/domain/runs/verdict'
import { assertWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import { workspaceOwnerMessage } from '@openrun/domain/tasks/unattendedGate'
import { workspaceHealthBlockedReason } from '@openrun/domain/workspaces/workspaceHealth'
import { assertWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import type { WebhookFilters } from '@openrun/domain/integrations/types'
import { getDb, type TaskRow } from '../storage/db.ts'
import { cancelRunsForTask, startRun } from '../execution/executor.ts'
import { clearQueueForTask, listQueue } from '../execution/runQueue.ts'
import { syncTask, unscheduleTask } from '../scheduling/scheduler.ts'
import { unattendedRefusal, unattendedRefusalFor } from '../execution/unattendedPreflight.ts'
import { getUnattendedWorkspaceOwner, resolveWorkspacePath } from '../workspaces/workspaces.ts'
import {
  checkWorkspace,
  clearWorkspaceBlock,
  restoreWorkspace,
  type RestoreResult,
} from '../workspaces/workspaceHealth.ts'
import { assertSchedulableCron } from '../scheduling/cronValidation.ts'
import { id } from './id.ts'
import { type TaskWithMeta, assertTaskWorkspaceIdle, nextRun, getTask } from './taskQueries.ts'
import {
  assertTaskRuntimeOnPath,
  assertNativeResume,
  assertUnattendedVerificationConfigured,
  getRuntime,
} from './runtimes.ts'

export type TaskInput = {
  baseRef?: string
  id?: string
  name: string
  description: string
  runtimeId: string
  prompt: string
  cwd: string
  workspaceId: string
  cron: string
  enabled: boolean
  model?: string
  effort?: string
  /** Webhook connection id; empty clears the webhook trigger. */
  webhookIntegrationId?: string
  /** Provider event ids to match; empty/omitted = all events on that connection. */
  webhookEvents?: string[]
  /** Optional label/project/status filters. */
  webhookFilters?: WebhookFilters
  /** Run the project's verification checks after each turn (default on). */
  verifyEnabled?: boolean
  /** Repair turns allowed on a failed-checks run; capped at MAX_REPAIR_ATTEMPTS. */
  maxRepairAttempts?: number
  /** Wall-clock budget in minutes; 0 / omitted = the app default. */
  timeoutMinutes?: number
  /** Native CLI session id to resume; empty clears. */
  resumeSessionId?: string
  /** Picker title captured with resumeSessionId. */
  resumeSessionLabel?: string
  /** Disable after the next successful scheduled fire. */
  fireOnce?: boolean
  /** Absolute epoch milliseconds for a one-shot schedule. */
  scheduledAt?: number
  /** Require an app-managed worktree for unattended fires (default on). */
  requireIsolation?: boolean
  /** Refuse to arm or fire unless `gh` is installed and authenticated. */
  requireGhAuth?: boolean
}

export function upsertTask(input: TaskInput): TaskWithMeta {
  const cron = normalizeCron(input.cron)
  assertSchedulableCron(cron)
  // Automations must target a real worktree — empty workspaceId used to fall
  // through to process.cwd() (the Open Run app) on run.
  const workspaceId = assertWorkspaceId(input.workspaceId)
  // Blank prompts used to save and then Run now spawned the CLI with nothing
  // useful to do — refuse up front (same message as TaskForm).
  const prompt = assertTaskPrompt(input.prompt)
  // Arming (enabled) with a missing CLI used to succeed — schedule looked
  // healthy, then cron only logged and never created a run. Refuse up front.
  if (input.enabled) assertTaskRuntimeOnPath(input.runtimeId)
  const db = getDb()
  const tid = input.id ?? id('task')
  const now = Date.now()
  const existingRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(tid) as TaskRow | undefined
  if (existingRow && existingRow.workspaceId !== workspaceId) {
    assertTaskWorkspaceIdle(tid)
  }

  const baseRef = input.baseRef?.trim() ?? existingRow?.baseRef ?? ''
  const resumeSessionId =
    input.resumeSessionId !== undefined
      ? input.resumeSessionId.trim()
      : (existingRow?.resumeSessionId ?? '')
  const resumeSessionLabel =
    input.resumeSessionLabel !== undefined
      ? input.resumeSessionLabel.trim()
      : (existingRow?.resumeSessionLabel ?? '')
  const baseRefusal = automationBaseRefusal(workspaceId, baseRef)
  if (baseRefusal) throw new Error(baseRefusal)

  // cwd stays the source of truth for git operations (executor, diff panel,
  // etc.) — resolve once here so cwd stays in sync with the workspace path.
  const cwd = resolveWorkspacePath(workspaceId)

  const webhookIntegrationId =
    input.webhookIntegrationId !== undefined
      ? input.webhookIntegrationId.trim()
      : (existingRow?.webhookIntegrationId ?? '')
  if (webhookIntegrationId) {
    const integ = db
      .prepare('SELECT id FROM integrations WHERE id = ?')
      .get(webhookIntegrationId) as { id: string } | undefined
    if (!integ) throw new Error('Webhook integration not found')
  }
  const webhookEvents = JSON.stringify(
    input.webhookEvents !== undefined
      ? input.webhookEvents.filter((e) => typeof e === 'string' && e.trim())
      : (() => {
          try {
            const parsed = JSON.parse(existingRow?.webhookEvents || '[]') as unknown
            return Array.isArray(parsed) ? parsed.filter((e) => typeof e === 'string') : []
          } catch {
            return []
          }
        })(),
  )
  const webhookFilters = JSON.stringify(
    input.webhookFilters !== undefined
      ? input.webhookFilters
      : (() => {
          try {
            return JSON.parse(existingRow?.webhookFilters || '{}') as Record<string, unknown>
          } catch {
            return {}
          }
        })(),
  )

  // Verification settings default to "on, one repair attempt, app timeout" for
  // a new task, and are left alone on an edit that doesn't mention them.
  const verifyEnabled =
    input.verifyEnabled !== undefined
      ? input.verifyEnabled
        ? 1
        : 0
      : (existingRow?.verifyEnabled ?? 1)
  const maxRepairAttempts =
    input.maxRepairAttempts !== undefined
      ? clampRepairAttempts(input.maxRepairAttempts)
      : (existingRow?.maxRepairAttempts ?? 1)
  const timeoutMs =
    input.timeoutMinutes !== undefined
      ? assertRunTimeoutMinutes(input.timeoutMinutes)
      : (existingRow?.timeoutMs ?? 0)

  const requireIsolation = 0
  const requireGhAuth =
    input.requireGhAuth !== undefined
      ? input.requireGhAuth
        ? 1
        : 0
      : (existingRow?.requireGhAuth ?? 0)
  const fireOnce =
    input.fireOnce !== undefined ? (input.fireOnce ? 1 : 0) : (existingRow?.fireOnce ?? 0)
  const requestedScheduledAt = Number(input.scheduledAt ?? 0)
  const scheduledAt = fireOnce
    ? requestedScheduledAt > 0
      ? Math.floor(requestedScheduledAt)
      : existingRow?.fireOnce && existingRow.cron === cron && existingRow.scheduledAt > 0
        ? existingRow.scheduledAt
        : (nextRun(cron) ?? 0)
    : 0
  if (fireOnce && (!cron || scheduledAt <= 0)) {
    throw new Error('A one-shot automation needs a valid future fire time.')
  }

  if (input.enabled) assertNativeResume({ resumeSessionId, runtimeId: input.runtimeId, cwd })

  const unattendedTask = Boolean(cron.trim() || webhookIntegrationId)
  if (input.enabled && unattendedTask) {
    assertUnattendedVerificationConfigured(workspaceId, verifyEnabled)
    const owner = getUnattendedWorkspaceOwner(workspaceId, tid)
    if (owner) throw new Error(workspaceOwnerMessage(owner.name))
  }

  // Saving as enabled arms the schedule, so it answers to the same AFK rules
  // as the Enable toggle — otherwise the form is a way around them.
  if (input.enabled) {
    const checked = checkWorkspace(workspaceId)
    const runtime = getRuntime(input.runtimeId)
    if (checked && runtime) {
      const refused = unattendedRefusalFor({
        task: { requireIsolation, requireGhAuth, baseRef, resumeSessionId, fireOnce },
        trigger: webhookIntegrationId ? 'webhook' : 'schedule',
        runtime,
        workspace: checked.workspace,
        health: checked.health,
      })
      if (refused) throw new Error(refused)
    }
  }

  db.prepare(
    `INSERT INTO tasks (id, name, description, runtimeId, prompt, cwd, workspaceId, baseRef, cron, enabled, model, effort, webhookIntegrationId, webhookEvents, webhookFilters, verifyEnabled, maxRepairAttempts, timeoutMs, resumeSessionId, resumeSessionLabel, fireOnce, scheduledAt, requireIsolation, requireGhAuth, createdAt, updatedAt, lastRunAt)
     VALUES (@id, @name, @description, @runtimeId, @prompt, @cwd, @workspaceId, @baseRef, @cron, @enabled, @model, @effort, @webhookIntegrationId, @webhookEvents, @webhookFilters, @verifyEnabled, @maxRepairAttempts, @timeoutMs, @resumeSessionId, @resumeSessionLabel, @fireOnce, @scheduledAt, @requireIsolation, @requireGhAuth, @createdAt, @updatedAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name=@name, description=@description, runtimeId=@runtimeId, prompt=@prompt,
       cwd=@cwd, workspaceId=@workspaceId, baseRef=@baseRef, cron=@cron, enabled=@enabled,
       model=@model, effort=@effort,
       webhookIntegrationId=@webhookIntegrationId, webhookEvents=@webhookEvents,
       webhookFilters=@webhookFilters, verifyEnabled=@verifyEnabled,
       maxRepairAttempts=@maxRepairAttempts, timeoutMs=@timeoutMs,
       resumeSessionId=@resumeSessionId, resumeSessionLabel=@resumeSessionLabel,
       fireOnce=@fireOnce, scheduledAt=@scheduledAt,
       requireIsolation=@requireIsolation, requireGhAuth=@requireGhAuth,
       updatedAt=@updatedAt`,
  ).run({
    id: tid,
    baseRef,
    name: input.name,
    description: input.description,
    runtimeId: input.runtimeId,
    prompt,
    cwd,
    workspaceId,
    cron,
    enabled: input.enabled ? 1 : 0,
    model: input.model?.trim() ?? '',
    effort: input.effort?.trim() ?? '',
    webhookIntegrationId,
    webhookEvents,
    webhookFilters,
    verifyEnabled,
    maxRepairAttempts,
    timeoutMs,
    resumeSessionId,
    resumeSessionLabel,
    fireOnce,
    scheduledAt,
    requireIsolation,
    requireGhAuth,
    createdAt: existingRow?.createdAt ?? now,
    updatedAt: now,
  })
  syncTask(tid)
  return getTask(tid)!
}

/**
 * Persist only the webhook trigger of an existing task. The full upsert
 * validates cron/prompt/workspace, so an in-progress form edit could not save
 * its webhook wiring alone — this writes those three columns and nothing else.
 */
export function updateTaskWebhook(input: {
  taskId: string
  webhookIntegrationId?: string
  webhookEvents?: string[]
  webhookFilters?: WebhookFilters
}): TaskWithMeta | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(input.taskId) as
    | TaskRow
    | undefined
  if (!row) return undefined

  const webhookIntegrationId = (input.webhookIntegrationId ?? '').trim()
  if (webhookIntegrationId) {
    const integ = db
      .prepare('SELECT id FROM integrations WHERE id = ?')
      .get(webhookIntegrationId) as { id: string } | undefined
    if (!integ) throw new Error('Webhook integration not found')
  }

  // Adding a webhook to an already-enabled automation is also an enable
  // operation. Do not let this narrow update bypass ownership or the AFK
  // preflight enforced by the full task form and Enable button.
  if (row.enabled === 1 && webhookIntegrationId) {
    assertUnattendedVerificationConfigured(row.workspaceId, row.verifyEnabled)
    const owner = getUnattendedWorkspaceOwner(row.workspaceId, row.id)
    if (owner) throw new Error(workspaceOwnerMessage(owner.name))
    const runtime = getRuntime(row.runtimeId)
    if (!runtime) throw new Error('Runtime not found for automation.')
    const refused = unattendedRefusal({ ...row, webhookIntegrationId }, runtime)
    if (refused) throw new Error(refused)
  }

  db.prepare(
    `UPDATE tasks SET webhookIntegrationId = ?, webhookEvents = ?, webhookFilters = ?, updatedAt = ? WHERE id = ?`,
  ).run(
    webhookIntegrationId,
    JSON.stringify((input.webhookEvents ?? []).filter((e) => typeof e === 'string' && e.trim())),
    JSON.stringify(input.webhookFilters ?? {}),
    Date.now(),
    input.taskId,
  )
  return getTask(input.taskId)
}

export function setTaskEnabled(taskId: string, enabled: boolean) {
  const db = getDb()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (!task) return undefined
  // Arming a schedule with a bad cron used to succeed and then silently never
  // fire — refuse enable so the developer fixes the expression first.
  // Same for a missing CLI: Run now already refuses; enable must too.
  if (enabled) {
    assertSchedulableCron(task.cron)
    assertWorkspaceId(task.workspaceId)
    if (task.cron.trim() || task.webhookIntegrationId.trim()) {
      assertUnattendedVerificationConfigured(task.workspaceId, task.verifyEnabled)
    }
    // Inspect the worktree, not just the row: arming an automation against a
    // workspace whose directory is gone used to succeed, and every fire after
    // it recorded an unexplained crash instead of one visible refusal.
    const checked = checkWorkspace(task.workspaceId)
    assertWorkspaceReady(checked?.workspace.status)
    assertTaskRuntimeOnPath(task.runtimeId)
    // Same as Create / Save — don't arm a schedule that would fire an empty prompt.
    assertTaskPrompt(task.prompt)
    assertNativeResume({
      resumeSessionId: task.resumeSessionId,
      runtimeId: task.runtimeId,
      cwd: task.cwd,
    })
    const owner = getUnattendedWorkspaceOwner(task.workspaceId, task.id)
    if (owner) throw new Error(workspaceOwnerMessage(owner.name))
    // Arming means "run this while nobody is watching" — hold it to the AFK
    // rules now rather than at 03:20 tomorrow morning.
    if (checked) {
      const runtime = getRuntime(task.runtimeId)
      const refused = runtime
        ? unattendedRefusalFor({
            task,
            trigger: task.webhookIntegrationId.trim() ? 'webhook' : 'schedule',
            runtime,
            workspace: checked.workspace,
            health: checked.health,
          })
        : null
      if (refused) throw new Error(refused)
    }
  }
  db.prepare('UPDATE tasks SET enabled = ?, updatedAt = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    Date.now(),
    taskId,
  )
  // Pausing means "stop firing" — a queue entry that fired before the pause
  // would otherwise start a run the user just disarmed. Also kill any agent
  // already in flight for this automation so Disable is a real kill switch.
  if (!enabled) {
    clearQueueForTask(taskId)
    cancelRunsForTask(taskId)
  }
  syncTask(taskId)
  return getTask(taskId)
}

export function deleteTask(taskId: string) {
  unscheduleTask(taskId)
  // Pending fires for a deleted automation would otherwise sit in the queue
  // until a drain discarded them one by one. Kill in-flight agents first.
  clearQueueForTask(taskId)
  cancelRunsForTask(taskId)
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
}

export function deleteTasks(taskIds: string[]): void {
  for (const id of [...new Set(taskIds)]) deleteTask(id)
}

/** Runs parked because their workspace was busy, oldest first. */
export function listPendingRuns() {
  const db = getDb()
  return listQueue().map((entry) => {
    const task = db.prepare('SELECT name FROM tasks WHERE id = ?').get(entry.taskId) as
      | { name: string }
      | undefined
    return { ...entry, taskName: task?.name ?? entry.taskId }
  })
}

export function runTaskNow(taskId: string): { runId: string } {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | TaskRow
    | undefined
  if (!task) throw new Error('Task not found')
  assertWorkspaceId(task.workspaceId)
  // Fail before startRun inserts a row — same readiness gate as chat, plus the
  // physical check that keeps a vanished worktree from surfacing as ENOENT.
  const checked = checkWorkspace(task.workspaceId)
  assertWorkspaceReady(checked?.workspace.status)
  if (checked) {
    const fatal = workspaceHealthBlockedReason(checked.health, { unattended: false })
    if (fatal) throw new Error(fatal)
  }
  const runtime = getRuntime(task.runtimeId)
  if (!runtime) throw new Error('Runtime not found for task')
  // Legacy blank prompts used to spawn a silent no-op — refuse before insert.
  assertTaskPrompt(task.prompt)
  assertNativeResume({
    resumeSessionId: task.resumeSessionId,
    runtimeId: task.runtimeId,
    cwd: task.cwd,
  })

  const runId = startRun({
    runtime,
    taskId: task.id,
    taskName: task.name,
    prompt: task.prompt,
    cwd: task.cwd,
    workspaceId: task.workspaceId,
    trigger: 'manual',
    model: task.model,
    effort: task.effort,
    timeoutMs: task.timeoutMs,
    resumeSessionId: task.resumeSessionId,
    resumeSessionLabel: task.resumeSessionLabel,
  })
  return { runId }
}

/**
 * Give an automation its own app-managed worktree on a dedicated branch, and
 * repoint it there.
 *
 * The AFK isolation rule refuses unattended fires against a project's shared
 * main checkout, and the fix is mechanical — create a worktree, move the task
 * onto it. Doing that by hand across a backlog of automations is where people
 * give up and switch isolation off instead, so it is one call.
 */
export async function isolateTaskWorkspace(taskId: string): Promise<TaskWithMeta> {
  const task = getTask(taskId)
  if (!task) throw new Error('Task not found')
  // Old clients may still offer this action. Isolation is automatic now.
  return task
}

/**
 * Throw away everything in an automation's worktree and put it back on its
 * configured branch, lifting the quarantine a failed run left behind.
 * Refuses on a `kind='main'` workspace — that is the user's own checkout.
 */
export function restoreTaskWorkspace(taskId: string): RestoreResult {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | TaskRow
    | undefined
  if (!task) throw new Error('Task not found')
  assertTaskWorkspaceIdle(taskId)
  return restoreWorkspace(assertWorkspaceId(task.workspaceId))
}

/** Same, addressed by workspace id — for the Projects panel. */
export function restoreWorkspaceById(workspaceId: string): RestoreResult {
  return restoreWorkspace(assertWorkspaceId(workspaceId))
}

/**
 * Lift a quarantine without touching the files — "I looked at what that run
 * left behind and it is fine to build on." Restore is the other answer.
 */
export function clearTaskWorkspaceQuarantine(taskId: string): TaskWithMeta {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | TaskRow
    | undefined
  if (!task) throw new Error('Task not found')
  assertTaskWorkspaceIdle(taskId)
  clearWorkspaceBlock(assertWorkspaceId(task.workspaceId))
  return getTask(taskId)!
}
