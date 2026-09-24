/** taskQueries capability implementation. */
import { usesFreshExecution } from '@openrun/domain/runs/executionWorkspace'
import { automationBaseRefusal } from '../execution/runEnvironment.ts'
import parser from 'cron-parser'
import { parseChecks } from '@openrun/domain/runs/checks'
import { resolveRunTimeoutMs } from '@openrun/domain/runs/runBudget'
import { hasTaskPrompt } from '@openrun/domain/tasks/taskPrompt'
import {
  runtimePromptDelivery,
  taskReadinessBlockers,
  type TaskReadinessBlocker,
} from '@openrun/domain/tasks/taskReadiness'
import { assertWorkspaceId, hasWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import {
  requiresGhAuth,
  unattendedBlockedReason,
  workspaceOwnerMessage,
} from '@openrun/domain/tasks/unattendedGate'
import type { WorkspaceHealth } from '@openrun/domain/workspaces/workspaceHealth'
import { taskActions, type TaskActions } from '@openrun/domain/tasks/actions'
import { assertWorkspaceReady, isWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import { resolveRuntimeLabel } from '@openrun/domain/runtimes/runtimeLabel'
import { parseTransport } from '@openrun/domain/runtimes/acpTransport'
import {
  isNativeResumeKind,
  nativeResumeKindFor,
  nativeSessionKindLabel,
  NATIVE_SESSION_PAGE_SIZE,
  paginateNativeSessions,
  type NativeSessionGroup,
  type NativeSessionKind,
} from '@openrun/domain/runtimes/nativeSessions'
import { getDb, type ScheduleFireRow, type TaskRow } from '../storage/db.ts'
import { queueDepthByTask } from '../execution/runQueue.ts'
import * as git from '../workspaces/git.ts'
import { checkRuntimeInstalled } from '../runtimes/runtimePath.ts'
import {
  getProject,
  getWorkspace,
  getUnattendedWorkspaceOwner,
  listWorkspaces,
  resolveWorkspacePath,
} from '../workspaces/workspaces.ts'
import { cachedWorkspaceHealth } from '../workspaces/workspaceHealth.ts'
import { listNativeSessionsForKind } from '../runtimes/nativeSessions.ts'
import { isSchedulableCron } from '../scheduling/cronValidation.ts'
import { latestScheduleFires } from '../scheduling/scheduleFires.ts'

import { getRuntime, nativeSessionValidForTask, listRuntimes } from './runtimes.ts'

export function nextRun(cronExpr: string): number | null {
  if (!cronExpr.trim()) return null
  try {
    return parser.parseExpression(cronExpr).next().getTime()
  } catch {
    return null
  }
}

export type TaskWithMeta = TaskRow & {
  /**
   * What may be done to this automation right now, and why not.
   *
   * Computed here from the same gate modules the web UI calls, so a client
   * that cannot run TypeScript — the macOS and iOS apps — gets the refusal
   * wording without owning a copy of the rule. See `lib/actions.ts`.
   */
  actions: TaskActions
  runtimeLabel: string
  nextRunAt: number | null
  cronValid: boolean
  /** False when workspaceId is blank — legacy rows that would hit process.cwd(). */
  workspaceValid: boolean
  /**
   * False when workspaceId is set but the worktree is still creating, in
   * error, archived, or missing — same gate as chat / resolveWorkspacePath.
   */
  workspaceReady: boolean
  /** Lifecycle status when the workspace row exists; null if blank or missing. */
  workspaceStatus: string | null
  /** False when the runtime row is missing or its binary is not on PATH. */
  runtimeInstalled: boolean
  /** False when the runtime row itself is missing. */
  runtimeValid: boolean
  /** Trimmed runtime binary name (for PATH-missing copy); empty if no runtime row. */
  runtimeBin: string
  /**
   * False when the stored prompt is empty / whitespace-only — legacy rows that
   * would spawn a CLI with nothing to do.
   */
  promptValid: boolean
  /**
   * False when resumeSessionId is set but the native chat is gone or the
   * runtime cannot resume native chats. True when no native session is bound.
   */
  resumeSessionValid: boolean
  /** Number of verification checks configured on this task's project. */
  checkCount: number
  /** Fires parked because the workspace was busy when they came due. */
  queuedCount: number
  /** Effective wall-clock budget in ms (the app default when unset on the task). */
  effectiveTimeoutMs: number
  /** Most recent scheduled-fire outcome, including fires that made no run. */
  lastScheduleFire: ScheduleFireRow | null
  /** 'main' (the user's shared checkout) or 'worktree'; '' when unresolved. */
  workspaceKind: string
  /**
   * What is physically on disk for the workspace right now — directory
   * present, still a worktree, on its configured branch, clean. Null when the
   * workspace id does not resolve. See lib/workspaceHealth.ts.
   */
  workspaceHealth: WorkspaceHealth | null
  /** True when this automation will reach for GitHub and so needs `gh`. */
  requiresGh: boolean
  ghInstalled: boolean
  ghAuthenticated: boolean
  /**
   * Why an unattended (schedule / webhook) fire would refuse, or null when it
   * may proceed. Attended Run now is judged by `runNowBlockedReason` instead.
   */
  unattendedBlockedReason: string | null
  /** id of the running run for this task, or null when idle. */
  activeRunId: string | null
  /** Whether the runtime has one unambiguous way to receive the prompt. */
  promptDeliveryValid: boolean
  promptDeliveryReason: string | null
  /** Connected webhook is present and enabled when this task has one. */
  triggerReady: boolean
  triggerBlockReason: string | null
  /** All current blockers, in the same order shown by task detail. */
  readinessBlockers: TaskReadinessBlocker[]
}

function activeRunByTask(): Record<string, string> {
  const rows = getDb()
    .prepare(
      `SELECT taskId, id FROM runs
       WHERE taskId IS NOT NULL AND status = 'running'
       ORDER BY startedAt ASC`,
    )
    .all() as Array<{ taskId: string; id: string }>
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (!out[row.taskId]) out[row.taskId] = row.id
  }
  return out
}

function decorate(
  task: TaskRow,
  queueDepths?: Record<string, number>,
  scheduleFires?: Record<string, ScheduleFireRow>,
  activeRuns?: Record<string, string>,
): TaskWithMeta {
  const runtime = getRuntime(task.runtimeId)
  const cronOk = isSchedulableCron(task.cron)
  const workspaceOk = hasWorkspaceId(task.workspaceId)
  const workspace = workspaceOk ? getWorkspace(task.workspaceId) : undefined
  const workspaceStatus = workspace?.status ?? null
  const workspaceReadyOk = workspaceOk && isWorkspaceReady(workspaceStatus)
  const runtimeBin = runtime?.bin?.trim() ?? ''
  const runtimeInstalled = runtime ? checkRuntimeInstalled(runtime.bin).installed : false
  const promptOk = hasTaskPrompt(task.prompt)
  const resumeOk = nativeSessionValidForTask(task)
  const project = workspace ? getProject(workspace.projectId) : undefined
  const promptDelivery = runtime
    ? runtimePromptDelivery({
        transport: parseTransport(runtime.transport),
        promptViaStdin: runtime.promptViaStdin === 1,
        argsTemplate: runtime.argsTemplate,
      })
    : { valid: false, reason: null }
  const integration = task.webhookIntegrationId.trim()
    ? (getDb()
        .prepare('SELECT enabled FROM integrations WHERE id = ?')
        .get(task.webhookIntegrationId) as { enabled: number } | undefined)
    : undefined
  const triggerReady = !task.webhookIntegrationId.trim() || integration?.enabled === 1
  const triggerBlockReason = task.webhookIntegrationId.trim()
    ? integration
      ? 'The selected webhook connection is disabled. Enable it before running this automation.'
      : 'The selected webhook connection no longer exists. Pick another connection before running this automation.'
    : null
  // Physical health is read, not repaired, here: `decorate` runs on every list
  // render, and demoting a row as a side effect of drawing a table would make
  // a transient NFS/rename hiccup permanent. The fire and arm paths call
  // `checkWorkspace`, which does demote.
  const health = workspace ? cachedWorkspaceHealth(workspace) : null
  const gh = git.ghStatus()
  const requiresGh = requiresGhAuth({
    canOpenPrs: runtime?.canOpenPrs === 1,
    requireGhAuth: task.requireGhAuth === 1,
  })
  const unattendedOwner = workspace ? getUnattendedWorkspaceOwner(workspace.id, task.id) : undefined
  const baseBlocked = automationBaseRefusal(task.workspaceId, task.baseRef)
  const unattendedBlocked =
    baseBlocked ||
    (unattendedOwner
      ? workspaceOwnerMessage(unattendedOwner.name)
      : workspace
        ? unattendedBlockedReason({
            freshExecution: usesFreshExecution({
              trigger: task.webhookIntegrationId.trim() ? 'webhook' : 'schedule',
              resumeSessionId: task.resumeSessionId,
            }),
            resumeSessionId: task.resumeSessionId,
            workspaceKind: workspace.kind,
            requireIsolation: task.requireIsolation === 1,
            fireOnce: task.fireOnce === 1,
            health,
            requiresGh,
            ghInstalled: gh.installed,
            ghAuthenticated: gh.authenticated,
          })
        : null)
  const readinessBlockers = taskReadinessBlockers({
    enabled: task.enabled,
    cron: task.cron,
    cronValid: cronOk,
    workspaceValid: workspaceOk,
    workspaceReady: workspaceReadyOk,
    workspaceStatus,
    runtimeInstalled,
    runtimeBin,
    promptValid: promptOk,
    ...(runtime
      ? {
          promptDeliveryValid: promptDelivery.valid,
          promptDeliveryReason: promptDelivery.reason,
        }
      : {}),
    resumeSessionId: task.resumeSessionId,
    resumeSessionValid: resumeOk,
    triggerReady,
    triggerBlockReason,
    verifyEnabled: task.verifyEnabled,
    checkCount: parseChecks(project?.checks).length,
    fireOnce: task.fireOnce,
    scheduledAt: task.scheduledAt,
    unattendedBlockedReason: unattendedBlocked,
    webhookIntegrationId: task.webhookIntegrationId,
    runtimeValid: Boolean(runtime),
  })
  const activeRunId = activeRuns?.[task.id] ?? null
  const meta = {
    ...task,
    workspaceKind: workspace?.kind ?? '',
    workspaceHealth: health,
    requiresGh,
    ghInstalled: gh.installed,
    ghAuthenticated: gh.authenticated,
    unattendedBlockedReason: unattendedBlocked,
    executionBlockedReason: baseBlocked,
    checkCount: parseChecks(project?.checks).length,
    effectiveTimeoutMs: resolveRunTimeoutMs(task.timeoutMs),
    lastScheduleFire: (scheduleFires ?? latestScheduleFires([task.id]))[task.id] ?? null,
    // Passed in when decorating a whole list, so one grouped query covers every
    // row instead of one COUNT per task.
    queuedCount: (queueDepths ?? queueDepthByTask())[task.id] ?? 0,
    runtimeLabel: resolveRuntimeLabel(runtime?.label, task.runtimeId),
    nextRunAt:
      task.enabled && readinessBlockers.length === 0
        ? task.fireOnce && task.scheduledAt > 0
          ? task.scheduledAt
          : nextRun(task.cron)
        : null,
    cronValid: cronOk,
    workspaceValid: workspaceOk,
    workspaceReady: workspaceReadyOk,
    workspaceStatus,
    runtimeInstalled,
    runtimeValid: Boolean(runtime),
    runtimeBin,
    promptValid: promptOk,
    resumeSessionValid: resumeOk,
    activeRunId,
    promptDeliveryValid: promptDelivery.valid,
    promptDeliveryReason: promptDelivery.reason,
    triggerReady,
    triggerBlockReason,
    readinessBlockers,
  }
  // The gates run once, here, and their answers travel with the row.
  return { ...meta, actions: taskActions(meta) }
}

export function listTasks(): TaskWithMeta[] {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY createdAt DESC').all() as TaskRow[]
  const depths = queueDepthByTask()
  const fires = latestScheduleFires(rows.map((row) => row.id))
  const activeRuns = activeRunByTask()
  return rows.map((row) => decorate(row, depths, fires, activeRuns))
}

function assertTaskWorkspaceIdle(taskId: string): void {
  const db = getDb()
  const running = db
    .prepare("SELECT id FROM runs WHERE taskId = ? AND status = 'running' LIMIT 1")
    .get(taskId) as { id: string } | undefined
  if (running) {
    throw new Error('Cannot change this workspace while a run is in progress. Stop the run first.')
  }
  const queuedRun = db
    .prepare("SELECT id FROM runs WHERE taskId = ? AND status = 'queued' LIMIT 1")
    .get(taskId) as { id: string } | undefined
  const queued = db.prepare('SELECT id FROM run_queue WHERE taskId = ? LIMIT 1').get(taskId) as
    | { id: string }
    | undefined
  if (queuedRun || queued) {
    throw new Error(
      'Cannot change this workspace while a run is queued. Let it drain or remove it first.',
    )
  }
}

/** Baseline/reset operations address a workspace, so account for every task. */
function assertWorkspaceMutationIdle(workspaceId: string): void {
  const db = getDb()
  const running = db
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running' LIMIT 1")
    .get(workspaceId) as { id: string } | undefined
  if (running) {
    throw new Error('Cannot change this workspace while a run is in progress. Stop the run first.')
  }
  const queuedRun = db
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'queued' LIMIT 1")
    .get(workspaceId) as { id: string } | undefined
  const queued = db
    .prepare('SELECT id FROM run_queue WHERE workspaceId = ? LIMIT 1')
    .get(workspaceId) as { id: string } | undefined
  if (queuedRun || queued) {
    throw new Error(
      'Cannot change this workspace while a run is queued. Let it drain or remove it first.',
    )
  }
}

function nativeResumeRuntimes(): Array<{
  kind: NativeSessionKind
  label: string
  bin: string
  runtimeId: string
}> {
  const seen = new Set<NativeSessionKind>()
  const out: Array<{
    kind: NativeSessionKind
    label: string
    bin: string
    runtimeId: string
  }> = []
  for (const runtime of listRuntimes()) {
    if (!checkRuntimeInstalled(runtime.bin).installed) continue
    const kind = nativeResumeKindFor(runtime)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    out.push({
      kind,
      label: runtime.label.trim() || nativeSessionKindLabel(kind),
      bin: runtime.bin,
      runtimeId: runtime.id,
    })
  }
  return out
}

export function listNativeSessions(input: {
  workspaceId?: string
  allWorkspaces?: boolean
  kind?: NativeSessionKind
  offset?: number
  limit?: number
}): { groups: NativeSessionGroup[]; error?: string } {
  const limit =
    input.limit && input.limit > 0
      ? input.limit
      : input.allWorkspaces
        ? 3
        : NATIVE_SESSION_PAGE_SIZE
  const offset = input.offset && input.offset > 0 ? input.offset : 0
  const requested =
    input.kind && isNativeResumeKind(input.kind)
      ? nativeResumeRuntimes().filter((row) => row.kind === input.kind)
      : nativeResumeRuntimes()

  try {
    const groups: NativeSessionGroup[] = requested.map((row) => {
      const sessions = input.allWorkspaces
        ? listWorkspaces()
            .filter((workspace) => workspace.status === 'ready' && workspace.exists)
            .flatMap((workspace) =>
              listNativeSessionsForKind(workspace.path, row.kind).map((session) => ({
                ...session,
                workspaceId: workspace.id,
                projectId: workspace.projectId,
                projectName: workspace.projectName,
              })),
            )
            .filter(
              (session, index, all) =>
                all.findIndex(
                  (candidate) =>
                    candidate.sessionId === session.sessionId &&
                    candidate.workspaceId === session.workspaceId,
                ) === index,
            )
            .sort((a, b) => b.modifiedAt - a.modifiedAt)
        : (() => {
            const workspaceId = assertWorkspaceId(input.workspaceId ?? '')
            const workspace = getWorkspace(workspaceId)
            assertWorkspaceReady(workspace?.status)
            return listNativeSessionsForKind(resolveWorkspacePath(workspaceId), row.kind)
          })()
      const page = paginateNativeSessions(sessions, offset, limit)
      return {
        kind: row.kind,
        label: row.label,
        bin: row.bin,
        runtimeId: row.runtimeId,
        sessions: page.items,
        hasMore: page.hasMore,
      }
    })
    return { groups }
  } catch (err) {
    return { groups: [], error: err instanceof Error ? err.message : String(err) }
  }
}

export function getTask(taskId: string): TaskWithMeta | undefined {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (!row) return undefined
  return decorate(row, queueDepthByTask(), latestScheduleFires([taskId]), activeRunByTask())
}

// Internal collaborators; the public facade exports only the API surface.
export { assertTaskWorkspaceIdle, assertWorkspaceMutationIdle }
