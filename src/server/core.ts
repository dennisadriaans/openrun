/**
 * Server-only facade.
 *
 * All server functions reach the database, executor and scheduler through this
 * single module. Importing it boots the cron scheduler exactly once. Route
 * components never import this directly — only via `createServerFn` handlers —
 * so none of the node-only dependencies leak into the client bundle.
 */
import parser from 'cron-parser'
import { assertArgsTemplate } from '../lib/argsTemplate'
import { parseChecks } from '../lib/checks'
import { assertValidCron, isValidCron, normalizeCron } from '../lib/cron'
import { assertRunTimeoutMinutes, resolveRunTimeoutMs } from '../lib/runBudget'
import { assertTaskPrompt, hasTaskPrompt } from '../lib/taskPrompt'
import { clampRepairAttempts, parseVerdict } from '../lib/verdict'
import { assertWorkspaceId, hasWorkspaceId } from '../lib/workspaceRef'
import { assertWorkspaceReady, isWorkspaceReady } from '../lib/workspaceReady'
import { parsePlanProposals, type PlanProposal } from '../lib/planProposals'
import { defaultEffort, defaultModel, findModel, type ModelOption } from '../lib/models'
import { cachedModelsForBin, warmModelCatalogs } from './modelCatalog'
import { parseRuntimeMode } from '../lib/runtimeMode'
import { compareRuntimesForDisplay } from '../lib/runtimePresets'
import { resolveRuntimeLabel } from '../lib/runtimeLabel'
import { acpTransportRefusal, parseTransport } from '../lib/acpTransport'
import {
  getDb,
  type CheckResultRow,
  type MessageRow,
  type RuntimeRow,
  type RunRow,
  type TaskRow,
} from './db'
import {
  answerApproval as _answerApproval,
  cancelRun as _cancelRun,
  cancelRunsForTask,
  installProcessShutdownHooks,
  listMessages,
  listTurnEventsForRun,
  reconcileOrphanRuns,
  runChecksNow as _runChecksNow,
  sendFollowUp,
  setRunFinalizedHook,
  startRun,
} from './executor'
import { listCheckResults } from './checks'
import { notifyRunFinished } from './notify'
import { clearQueueForTask, drainWorkspace, listQueue, queueDepthByTask } from './runQueue'
import type { ApprovalDecision } from '../lib/claudeControl'
import * as files from './files'
import * as git from './git'
import { supportsResume, runtimeKind } from './resume'
import { bootScheduler, syncTask, unscheduleTask } from './scheduler'
import type { TurnEventRow } from '../lib/turnEvents'
import { assistantTextFromEvents } from './turnEvents'
import { assertRuntimeOnPath, checkRuntimeInstalled } from './runtimePath'
import {
  previewRuntimeCommand,
  type PreviewCommandInput,
  type PreviewCommandResult,
} from './commandPreview'
import { getProject, getWorkspace, listWorkspaces, resolveWorkspacePath } from './workspaces'
import { bootCloud } from './cloud'
import { assertServerAccess } from './accessToken'

// Reap any CLI left behind by a previous process *before* arming cron or
// draining the queue — otherwise a phantom `running` row locks the workspace
// forever and a surviving orphan keeps spending tokens. Guarded so Vite HMR
// re-evaluating this module cannot cancel healthy in-flight runs.
// Refuse to do anything at all under a configuration that would let the
// network run commands as this user. Deliberately the first statement on the
// boot path: arming cron or reaping orphans on a machine that should not be
// serving is worse than failing loudly.
assertServerAccess()

const bootSafety = globalThis as unknown as { __agentopsSafetyBooted?: boolean }
if (!bootSafety.__agentopsSafetyBooted) {
  bootSafety.__agentopsSafetyBooted = true
  reconcileOrphanRuns()
  installProcessShutdownHooks()
}
bootScheduler()
warmModelCatalogs()

/**
 * Everything that has to happen once a run settles. Registered here rather
 * than imported by the executor: notification and (later) queue draining both
 * need to read tasks/projects, which would be a cycle straight back into the
 * executor.
 */
setRunFinalizedHook((runId) => {
  const run = getRun(runId)
  if (!run) return
  let changed = 0
  try {
    changed = git.changedFiles(run.cwd, run.baseSnapshot || undefined).length
  } catch {
    // Non-git or missing cwd — the notification just reports zero.
  }
  notifyRunFinished(runId, changed)
  // The workspace lock just came free — start whatever was waiting on it.
  if (run.workspaceId) drainWorkspace(run.workspaceId)
})

bootCloud()

// Re-exported so src/fns reaches the whole workspaces API through this single
// facade, the same way it already reaches tasks/runs/git — route code never
// imports server modules other than via createServerFn handlers.
export {
  addProject,
  archiveWorkspace,
  createLocalFolder,
  createWorkspace,
  deleteProject,
  getProject,
  getWorkspace,
  listLocalDirectories,
  listProjectBranches,
  listProjects,
  listWorkspaces,
  resolveWorkspacePath,
  runSetup,
  suggestProjectChecks,
  updateProject,
} from './workspaces'
export type { ProjectRow, WorkspaceRow } from './db'
export type {
  LocalDirEntry,
  LocalDirListing,
  ProjectWithMeta,
  WorkspaceWithMeta,
} from './workspaces'

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// Runtimes
// ---------------------------------------------------------------------------

/**
 * A runtime plus the models its installed binary currently offers. Carried on
 * the runtime rather than fetched separately so every model picker in the app
 * (new run, automation form, project defaults) gets the live catalog from a
 * request it was already making.
 */
export type RuntimeWithModels = RuntimeRow & { models: ModelOption[] }

export function listRuntimes(): RuntimeWithModels[] {
  const rows = getDb()
    .prepare('SELECT * FROM runtimes ORDER BY createdAt ASC')
    .all() as RuntimeRow[]
  return rows
    .sort(compareRuntimesForDisplay)
    .map((r) => ({ ...r, models: cachedModelsForBin(r.bin) }))
}

export function getRuntime(runtimeId: string): RuntimeRow | undefined {
  return getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(runtimeId) as
    | RuntimeRow
    | undefined
}

export type RuntimeInput = {
  id?: string
  label: string
  bin: string
  argsTemplate: string
  promptViaStdin: boolean
  description: string
  enabled: boolean
  /** Allow the agent to open its own PR during a run (ticket 05). */
  canOpenPrs?: boolean
  /** 'cli' (parse stdout) or 'acp' (speak Agent Client Protocol). */
  transport?: string
}

export function upsertRuntime(input: RuntimeInput): RuntimeRow {
  assertArgsTemplate(input.argsTemplate)
  const transport = parseTransport(input.transport)
  const refusal = acpTransportRefusal({ transport, bin: input.bin })
  if (refusal) throw new Error(refusal)
  const db = getDb()
  const rid = input.id ?? id('rt')
  const existing = db.prepare('SELECT createdAt FROM runtimes WHERE id = ?').get(rid) as
    | { createdAt: number }
    | undefined
  db.prepare(
    `INSERT INTO runtimes (id, label, bin, argsTemplate, promptViaStdin, description, enabled, canOpenPrs, transport, createdAt)
     VALUES (@id, @label, @bin, @argsTemplate, @promptViaStdin, @description, @enabled, @canOpenPrs, @transport, @createdAt)
     ON CONFLICT(id) DO UPDATE SET
       label=@label, bin=@bin, argsTemplate=@argsTemplate,
       promptViaStdin=@promptViaStdin, description=@description, enabled=@enabled,
       canOpenPrs=@canOpenPrs, transport=@transport`,
  ).run({
    id: rid,
    label: input.label,
    bin: input.bin,
    argsTemplate: input.argsTemplate,
    promptViaStdin: input.promptViaStdin ? 1 : 0,
    description: input.description,
    enabled: input.enabled ? 1 : 0,
    canOpenPrs: input.canOpenPrs ? 1 : 0,
    transport,
    createdAt: existing?.createdAt ?? Date.now(),
  })
  return getRuntime(rid)!
}

export function deleteRuntime(runtimeId: string) {
  getDb().prepare('DELETE FROM runtimes WHERE id = ?').run(runtimeId)
}

export { checkRuntimeInstalled } from './runtimePath'

export { previewRuntimeCommand }
export type { PreviewCommandInput, PreviewCommandResult }

/**
 * Preview the command for a saved runtime by id (e.g. tooling / scratchpad),
 * without round-tripping the runtime's bin / template through the client.
 */
export function previewRuntimeCommandById(input: {
  runtimeId: string
  workspaceId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  isFollowUp?: boolean
}): PreviewCommandResult {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) return { preview: null, error: 'Runtime not found' }
  return previewRuntimeCommand({
    bin: runtime.bin,
    argsTemplate: runtime.argsTemplate,
    promptViaStdin: runtime.promptViaStdin === 1,
    workspaceId: input.workspaceId,
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
    isFollowUp: input.isFollowUp,
  })
}

/** Refuse arming when the task's CLI binary is blank or missing from PATH. */
function assertTaskRuntimeOnPath(runtimeId: string): void {
  const runtime = getRuntime(runtimeId)
  if (!runtime) throw new Error('Runtime not found for task')
  assertRuntimeOnPath(runtime.bin)
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function nextRun(cronExpr: string): number | null {
  if (!cronExpr.trim()) return null
  try {
    return parser.parseExpression(cronExpr).next().getTime()
  } catch {
    return null
  }
}

export type TaskWithMeta = TaskRow & {
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
  /** Trimmed runtime binary name (for PATH-missing copy); empty if no runtime row. */
  runtimeBin: string
  /**
   * False when the stored prompt is empty / whitespace-only — legacy rows that
   * would spawn a CLI with nothing to do.
   */
  promptValid: boolean
  /** Number of verification checks configured on this task's project. */
  checkCount: number
  /** Fires parked because the workspace was busy when they came due. */
  queuedCount: number
  /** Effective wall-clock budget in ms (the app default when unset on the task). */
  effectiveTimeoutMs: number
}

function decorate(task: TaskRow, queueDepths?: Record<string, number>): TaskWithMeta {
  const runtime = getRuntime(task.runtimeId)
  const cronOk = isValidCron(task.cron)
  const workspaceOk = hasWorkspaceId(task.workspaceId)
  const workspace = workspaceOk ? getWorkspace(task.workspaceId) : undefined
  const workspaceStatus = workspace?.status ?? null
  const workspaceReadyOk = workspaceOk && isWorkspaceReady(workspaceStatus)
  const runtimeBin = runtime?.bin?.trim() ?? ''
  const runtimeInstalled = runtime ? checkRuntimeInstalled(runtime.bin).installed : false
  const promptOk = hasTaskPrompt(task.prompt)
  const project = workspace ? getProject(workspace.projectId) : undefined
  return {
    ...task,
    checkCount: parseChecks(project?.checks).length,
    effectiveTimeoutMs: resolveRunTimeoutMs(task.timeoutMs),
    // Passed in when decorating a whole list, so one grouped query covers every
    // row instead of one COUNT per task.
    queuedCount: (queueDepths ?? queueDepthByTask())[task.id] ?? 0,
    runtimeLabel: resolveRuntimeLabel(runtime?.label, task.runtimeId),
    nextRunAt:
      task.enabled && cronOk && workspaceReadyOk && runtimeInstalled && promptOk
        ? nextRun(task.cron)
        : null,
    cronValid: cronOk,
    workspaceValid: workspaceOk,
    workspaceReady: workspaceReadyOk,
    workspaceStatus,
    runtimeInstalled,
    runtimeBin,
    promptValid: promptOk,
  }
}

export function listTasks(): TaskWithMeta[] {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY createdAt DESC').all() as TaskRow[]
  const depths = queueDepthByTask()
  return rows.map((row) => decorate(row, depths))
}

export function getTask(taskId: string): TaskWithMeta | undefined {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  return row ? decorate(row) : undefined
}

export type TaskInput = {
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
  webhookFilters?: {
    labels?: string[]
    projects?: string[]
    statuses?: string[]
    previousStatuses?: string[]
    assignees?: string[]
  }
  /** Run the project's verification checks after each turn (default on). */
  verifyEnabled?: boolean
  /** Repair turns allowed on a failed-checks run; capped at MAX_REPAIR_ATTEMPTS. */
  maxRepairAttempts?: number
  /** Wall-clock budget in minutes; 0 / omitted = the app default. */
  timeoutMinutes?: number
}

export function upsertTask(input: TaskInput): TaskWithMeta {
  const cron = normalizeCron(input.cron)
  assertValidCron(cron)
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

  db.prepare(
    `INSERT INTO tasks (id, name, description, runtimeId, prompt, cwd, workspaceId, cron, enabled, model, effort, webhookIntegrationId, webhookEvents, webhookFilters, verifyEnabled, maxRepairAttempts, timeoutMs, createdAt, updatedAt, lastRunAt)
     VALUES (@id, @name, @description, @runtimeId, @prompt, @cwd, @workspaceId, @cron, @enabled, @model, @effort, @webhookIntegrationId, @webhookEvents, @webhookFilters, @verifyEnabled, @maxRepairAttempts, @timeoutMs, @createdAt, @updatedAt, NULL)
     ON CONFLICT(id) DO UPDATE SET
       name=@name, description=@description, runtimeId=@runtimeId, prompt=@prompt,
       cwd=@cwd, workspaceId=@workspaceId, cron=@cron, enabled=@enabled,
       model=@model, effort=@effort,
       webhookIntegrationId=@webhookIntegrationId, webhookEvents=@webhookEvents,
       webhookFilters=@webhookFilters, verifyEnabled=@verifyEnabled,
       maxRepairAttempts=@maxRepairAttempts, timeoutMs=@timeoutMs,
       updatedAt=@updatedAt`,
  ).run({
    id: tid,
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
    createdAt: existingRow?.createdAt ?? now,
    updatedAt: now,
  })
  syncTask(tid)
  return getTask(tid)!
}

export function setTaskEnabled(taskId: string, enabled: boolean) {
  const db = getDb()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (!task) return undefined
  // Arming a schedule with a bad cron used to succeed and then silently never
  // fire — refuse enable so the developer fixes the expression first.
  // Same for a missing CLI: Run now already refuses; enable must too.
  if (enabled) {
    assertValidCron(task.cron)
    assertWorkspaceId(task.workspaceId)
    const workspace = getWorkspace(task.workspaceId)
    assertWorkspaceReady(workspace?.status)
    assertTaskRuntimeOnPath(task.runtimeId)
    // Same as Create / Save — don't arm a schedule that would fire an empty prompt.
    assertTaskPrompt(task.prompt)
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
  // Fail before startRun inserts a row — same readiness gate as chat.
  const workspace = getWorkspace(task.workspaceId)
  assertWorkspaceReady(workspace?.status)
  const runtime = getRuntime(task.runtimeId)
  if (!runtime) throw new Error('Runtime not found for task')
  // Legacy blank prompts used to spawn a silent no-op — refuse before insert.
  assertTaskPrompt(task.prompt)

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
  })
  return { runId }
}

/** Most recent non-archived run in a workspace, or null when none exist yet. */
export function getLatestRunForWorkspace(workspaceId: string): RunRow | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM runs WHERE workspaceId = ? AND archivedAt IS NULL ORDER BY startedAt DESC LIMIT 1',
    )
    .get(workspaceId) as RunRow | undefined
  return row ?? null
}

/** Start an ad-hoc chat run in a workspace — no task/automation required. */
export function startChat(input: {
  workspaceId: string
  runtimeId: string
  prompt: string
  model?: string
  effort?: string
  runtimeMode?: string
}): { runId: string } {
  const workspace = getWorkspace(input.workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  assertWorkspaceReady(workspace.status)
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('A first message is required')

  const runtime = getRuntime(input.runtimeId)
  if (!runtime) throw new Error('Runtime not found')

  const runId = startRun({
    runtime,
    taskId: null,
    taskName: `Chat · ${workspace.branch}`,
    prompt,
    cwd: '',
    workspaceId: workspace.id,
    trigger: 'chat',
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
  })
  return { runId }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunSummary = Omit<RunRow, 'stdout' | 'stderr'> & {
  stdoutBytes: number
  stderrBytes: number
  /** Display name from the runtime row; falls back to runtimeId when missing. */
  runtimeLabel: string
}

export function listRuns(opts?: {
  taskId?: string
  limit?: number
  /** When true, return archived runs only; default is active (non-archived) runs. */
  includeArchived?: boolean
}): RunSummary[] {
  const limit = opts?.limit ?? 50
  const db = getDb()
  const archivedClause = opts?.includeArchived
    ? 'AND archivedAt IS NOT NULL'
    : 'AND archivedAt IS NULL'
  const rows = (
    opts?.taskId
      ? db
          .prepare(
            `SELECT id, taskId, taskName, runtimeId, trigger, status, command, cwd, pid, exitCode,
                    length(stdout) AS stdoutBytes, length(stderr) AS stderrBytes, startedAt, finishedAt,
                    archivedAt, verdict, repairAttempts, timedOut
             FROM runs WHERE taskId = ? ${archivedClause} ORDER BY startedAt DESC LIMIT ?`,
          )
          .all(opts.taskId, limit)
      : db
          .prepare(
            `SELECT id, taskId, taskName, runtimeId, trigger, status, command, cwd, pid, exitCode,
                    length(stdout) AS stdoutBytes, length(stderr) AS stderrBytes, startedAt, finishedAt,
                    archivedAt, verdict, repairAttempts, timedOut
             FROM runs WHERE 1=1 ${archivedClause} ORDER BY startedAt DESC LIMIT ?`,
          )
          .all(limit)
  ) as Omit<RunSummary, 'runtimeLabel'>[]
  const labelById = new Map(listRuntimes().map((runtime) => [runtime.id, runtime.label] as const))
  return rows.map((row) => ({
    ...row,
    runtimeLabel: resolveRuntimeLabel(labelById.get(row.runtimeId), row.runtimeId),
  }))
}

/** Verification results for a run, oldest pass first. */
export function listRunChecks(runId: string): CheckResultRow[] {
  return listCheckResults(runId)
}

/** Re-run the project's checks against a finished run, on the user's say-so. */
export async function rerunRunChecks(runId: string): Promise<CheckResultRow[]> {
  return _runChecksNow(runId)
}

export function getRun(runId: string): RunRow | undefined {
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
}

export function cancelRun(runId: string) {
  _cancelRun(runId)
  return getRun(runId)
}

export function archiveRun(runId: string): RunRow {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  if (run.status === 'running') throw new Error('Cancel the run before archiving it')
  if (run.archivedAt) return run
  getDb().prepare('UPDATE runs SET archivedAt = ? WHERE id = ?').run(Date.now(), runId)
  return getRun(runId)!
}

export function unarchiveRun(runId: string): RunRow {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  getDb().prepare('UPDATE runs SET archivedAt = NULL WHERE id = ?').run(runId)
  return getRun(runId)!
}

export function deleteRun(runId: string): void {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  if (run.status === 'running') throw new Error('Cancel the run before deleting it')
  getDb().prepare('DELETE FROM runs WHERE id = ?').run(runId)
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export type ChatMessage = Omit<MessageRow, 'diffSummary'> & {
  diffSummary: git.DiffFile[]
  /** Structured turn events for this message (empty for legacy / generic runs). */
  events: TurnEventRow[]
}

const MAX_EVENT_PAYLOAD_CHARS = 4_000

/** Truncate oversized tool payloads so conversation polls stay light. */
function slimTurnEvent(ev: TurnEventRow): TurnEventRow {
  if (ev.payload.length <= MAX_EVENT_PAYLOAD_CHARS) return ev
  try {
    const obj = JSON.parse(ev.payload) as Record<string, unknown>
    for (const key of ['content', 'input', 'text', 'result']) {
      const val = obj[key]
      if (typeof val === 'string' && val.length > 1_500) {
        obj[key] = `${val.slice(0, 1_500)}…`
      }
    }
    const next = JSON.stringify(obj)
    if (next.length <= MAX_EVENT_PAYLOAD_CHARS) return { ...ev, payload: next }
  } catch {
    // fall through
  }
  return { ...ev, payload: `${ev.payload.slice(0, MAX_EVENT_PAYLOAD_CHARS)}…` }
}

/**
 * Chat-focused conversation payload (no git/`gh` work). Right panel data lives
 * in `getRunWorkspace` so polling the live chat does not re-shell git.
 */
export function getConversation(runId: string) {
  const run = getRun(runId)
  if (!run) return null

  const runtime = getRuntime(run.runtimeId)
  const stored = listMessages(runId)
  const eventsByMessage = new Map<string, TurnEventRow[]>()
  for (const ev of listTurnEventsForRun(runId)) {
    const list = eventsByMessage.get(ev.messageId) ?? []
    list.push(slimTurnEvent(ev))
    eventsByMessage.set(ev.messageId, list)
  }
  const messages: ChatMessage[] =
    stored.length > 0
      ? stored.map((m) => {
          const events = eventsByMessage.get(m.id) ?? []
          const fromEvents =
            m.role === 'assistant' && events.length > 0 ? assistantTextFromEvents(events) : ''
          // Prefer events for chat text; omit duplicating fat per-message logs
          // when structured events already carry the turn.
          const hasEvents = events.length > 0
          return {
            ...m,
            content: fromEvents || m.content,
            stdout: hasEvents ? '' : m.stdout,
            stderr: hasEvents ? '' : m.stderr,
            diffSummary: parseDiffSummary(m.diffSummary),
            events,
          }
        })
      : synthesizeLegacyMessages(run)

  const workspace = run.workspaceId ? getWorkspace(run.workspaceId) : undefined
  const siblings = workspace ? listWorkspaces(workspace.projectId) : []
  const workspaceWithMeta = workspace ? (siblings.find((w) => w.id === workspace.id) ?? null) : null
  const project = workspace ? (getProject(workspace.projectId) ?? null) : null

  const catalog = runtime ? cachedModelsForBin(runtime.bin) : []
  const matchedModel = findModel(catalog, run.model)
  const selectedModel = matchedModel ?? defaultModel(catalog)

  const siblingWorkspaces = siblings.filter((w) => w.status !== 'archived')

  return {
    run,
    messages,
    checkResults: listCheckResults(runId),
    verdict: parseVerdict(run.verdict),
    canFollowUp:
      run.status !== 'running' &&
      !!runtime &&
      supportsResume(runtime.bin, runtime.transport) &&
      (run.sessionId.length > 0 || runtimeSupportsLastResume(runtime.bin)),
    workspace: workspaceWithMeta,
    project,
    workspaces: siblingWorkspaces,
    runtime: runtime
      ? {
          id: runtime.id,
          label: runtime.label,
          bin: runtime.bin,
          // The composer needs it to know whether Supervised is offered.
          transport: parseTransport(runtime.transport),
        }
      : null,
    models: catalog as ModelOption[],
    model: selectedModel?.slug || '',
    effort: matchedModel
      ? run.effort || defaultEffort(selectedModel)
      : defaultEffort(selectedModel),
    runtimeMode: parseRuntimeMode(run.runtimeMode),
  }
}

/** Files / repo / gh for the run detail right panel — deferred from chat load. */
export function getRunWorkspace(runId: string) {
  const run = getRun(runId)
  if (!run) return null

  const files = git.changedFiles(run.cwd, run.baseSnapshot || undefined)
  const repo = git.repoInfo(run.cwd)
  // Derive dirty from the same file list — avoid a second changedFiles pass.
  if (run.baseSnapshot) {
    repo.dirty = files.length > 0
  }

  return {
    runId,
    files,
    repo,
    totals: {
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    },
    gh: git.ghStatus(),
    taskName: run.taskName,
    baseBranch: run.baseBranch,
  }
}

/**
 * Runs recorded before conversations existed have stdout/stderr on the run row
 * but no message rows. Present them as a single assistant turn so the chat view
 * still shows their output instead of an empty transcript.
 */
function synthesizeLegacyMessages(run: RunRow): ChatMessage[] {
  if (!run.stdout && !run.stderr) return []
  return [
    {
      id: `${run.id}_legacy`,
      runId: run.id,
      role: 'assistant',
      content: run.stdout.trim() || run.stderr.trim(),
      stdout: run.stdout,
      stderr: run.stderr,
      status: run.status,
      exitCode: run.exitCode,
      diffSummary: [],
      createdAt: run.startedAt,
      finishedAt: run.finishedAt,
      events: [],
    },
  ]
}

/** Codex can resume its most recent session without an explicit id. */
function runtimeSupportsLastResume(bin: string) {
  return (bin.split(/[\\/]/).pop() ?? bin).includes('codex')
}

function parseDiffSummary(raw: string): git.DiffFile[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as git.DiffFile[]) : []
  } catch {
    return []
  }
}

/**
 * Answer a pending tool-approval on a supervised (Claude) run. Writes the
 * allow/deny decision to the live child's stdin control channel. Returns false
 * when there is no matching pending request (already resolved or timed out).
 */
export function answerApproval(input: {
  runId: string
  requestId: string
  /** ACP option id the user picked; falls back to a plain allow/deny. */
  optionId?: string
  decision?: ApprovalDecision
  message?: string
}): { answered: boolean } {
  return { answered: _answerApproval(input) }
}

/** Hard cap on follow-up prompt size to avoid accidental stdin/DB bloat. */
const MAX_MESSAGE_PROMPT_CHARS = 100_000

export function postMessage(input: {
  runId: string
  prompt: string
  model?: string
  effort?: string
  runtimeMode?: string
}) {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Message cannot be empty')
  if (prompt.length > MAX_MESSAGE_PROMPT_CHARS) {
    throw new Error(
      `Message is too long (max ${MAX_MESSAGE_PROMPT_CHARS.toLocaleString()} characters)`,
    )
  }
  return sendFollowUp({
    runId: input.runId,
    prompt,
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
  })
}

// ---------------------------------------------------------------------------
// Git — file review and write actions, scoped to a run's workspace
// ---------------------------------------------------------------------------

function runCwd(runId: string): string {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  return run.cwd
}

export function getFileDiff(input: { runId: string; path: string }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  return {
    path: input.path,
    diff: git.fileDiff(run.cwd, input.path, run.baseSnapshot || undefined),
  }
}

// --- Workspace files -------------------------------------------------------

export function listWorkspaceFiles(input: { runId: string; dir?: string }) {
  return { entries: files.listDirectory(runCwd(input.runId), input.dir ?? '') }
}

export function readWorkspaceFile(input: { runId: string; path: string }) {
  return files.readWorkspaceFile(runCwd(input.runId), input.path)
}

export function writeWorkspaceFile(input: { runId: string; path: string; content: string }) {
  return files.writeWorkspaceFile(runCwd(input.runId), input.path, input.content)
}

/**
 * Paths still dirty vs HEAD that are also part of the run delta. Used so
 * commit only stages run-owned changes (already-committed mid-run work is
 * skipped; pre-existing dirt outside the delta is skipped).
 */
function commitableRunPaths(
  run: { cwd: string; baseSnapshot: string },
  paths?: string[],
): string[] | undefined {
  if (!run.baseSnapshot) return paths

  const delta = new Set(git.changedFiles(run.cwd, run.baseSnapshot).map((f) => f.path))
  const dirtyVsHead = new Set(git.changedFiles(run.cwd).map((f) => f.path))
  const scoped = [...delta].filter((p) => dirtyVsHead.has(p))
  if (paths && paths.length > 0) {
    return paths.filter((p) => scoped.includes(p))
  }
  return scoped
}

export function commitChanges(input: { runId: string; message: string; paths?: string[] }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  const paths = commitableRunPaths(run, input.paths)
  if (run.baseSnapshot && (!paths || paths.length === 0)) {
    throw new Error('Nothing staged to commit')
  }
  return git.commit(run.cwd, input.message, paths)
}

export function pushChanges(input: { runId: string }) {
  return git.push(runCwd(input.runId))
}

export function discardChanges(input: { runId: string; paths?: string[] }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  return git.discard(run.cwd, input.paths, run.baseSnapshot || undefined)
}

export function createBranch(input: { runId: string; name: string }) {
  return git.createBranch(runCwd(input.runId), input.name)
}

export function openPullRequest(input: {
  runId: string
  title: string
  body: string
  base?: string
}) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')

  // Default an unspecified base to the *project's* default branch, not just
  // "whatever git would pick" — a worktree is typically branched off another
  // worktree's in-progress branch (fromBranch), and that branch was never
  // pushed to origin. Opening a PR against it would fail or target a branch
  // the reviewer can't see. The project's defaultBranch is always a real,
  // pushed branch, so it's the only safe default.
  let base = input.base
  if (!base) {
    const workspace = run.workspaceId ? getWorkspace(run.workspaceId) : undefined
    const project = workspace ? getProject(workspace.projectId) : undefined
    base = project?.defaultBranch
  }

  return git.createPullRequest({
    cwd: run.cwd,
    title: input.title,
    body: input.body,
    base,
  })
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export function getDashboard() {
  const db = getDb()
  const tasks = listTasks()
  const enabled = tasks.filter((t) => t.enabled)
  const scheduled = enabled.filter((t) => t.cron.trim() && t.nextRunAt)

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const runsToday = (
    db.prepare('SELECT COUNT(*) AS n FROM runs WHERE startedAt >= ?').get(dayAgo) as { n: number }
  ).n
  const successToday = (
    db
      .prepare("SELECT COUNT(*) AS n FROM runs WHERE startedAt >= ? AND status = 'success'")
      .get(dayAgo) as { n: number }
  ).n
  const running = (
    db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").get() as { n: number }
  ).n

  const upcoming = scheduled
    .slice()
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 6)

  const recentRuns = listRuns({ limit: 8 })

  // Runs that finished today and are waiting on a human — the queue the
  // dashboard should actually be pointing at.
  const needsAttention = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM runs
         WHERE startedAt >= ? AND verdict IN ('failed-checks', 'timeout', 'crashed')
           AND archivedAt IS NULL`,
      )
      .get(dayAgo) as { n: number }
  ).n

  return {
    stats: {
      totalTasks: tasks.length,
      enabledTasks: enabled.length,
      scheduledTasks: scheduled.length,
      runsToday,
      successRate: runsToday > 0 ? Math.round((successToday / runsToday) * 100) : null,
      running,
      needsAttention,
      queued: tasks.reduce((n, t) => n + t.queuedCount, 0),
    },
    upcoming,
    recentRuns,
    pending: listPendingRuns(),
  }
}

// ---------------------------------------------------------------------------
// Planner — turn a high-level objective into proposed scheduled tasks by
// asking a local CLI runtime to emit structured JSON. No API tokens involved:
// it drives whichever coding-agent CLI the user already has logged in.
// ---------------------------------------------------------------------------

export type { PlanProposal }

function buildPlannerPrompt(objective: string): string {
  return `You are an automation planner. Break the goal below into a small set of
concrete recurring automations that a local coding-agent CLI could run unattended.
Do not use tools, edit files, or explore the filesystem — answer from the goal alone.

${objective}

Respond with ONLY a JSON array (no prose, no markdown fences). Each element must be:
{ "name": string, "description": string, "prompt": string, "cron": string }
- "prompt" is the full concrete instruction handed to the agent at run time — write
  the real task text, not a placeholder or a reference to "the objective" / "the goal".
- "cron" is a standard 5-field cron expression for when it should run.
Return 2-5 automations.`
}

export async function planObjective(input: {
  objective: string
  runtimeId: string
  /** Workspace proposals will install into — required. */
  workspaceId: string
}): Promise<{ proposals: PlanProposal[]; raw: string; runId: string }> {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) throw new Error('Runtime not found')

  const objective = input.objective.trim()
  if (!objective) throw new Error('An objective is required')

  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)

  const plannerKind = runtimeKind(runtime.bin)
  const plannerArgs =
    plannerKind === 'codex'
      ? ['exec', '--skip-git-repo-check', '-']
      : plannerKind === 'grok'
        ? ['--prompt-file', '{promptFile}', '--output-format', 'plain', '--always-approve']
        : ['-p', '--output-format', 'text', '--dangerously-skip-permissions']
  const plannerRuntime: RuntimeRow = {
    ...runtime,
    canOpenPrs: 0,
    // Planning wants one cheap plain-text answer, which is exactly what the
    // args above ask for — so it always takes the CLI path, even when the
    // runtime is normally driven over ACP.
    transport: 'cli',
    promptViaStdin: plannerKind === 'grok' ? 0 : 1,
    argsTemplate: JSON.stringify(plannerArgs),
  }

  const runId = startRun({
    runtime: plannerRuntime,
    taskId: null,
    taskName: `Planner: ${objective.slice(0, 40)}`,
    // Chat shows the goal; the CLI gets the planning wrapper around it.
    prompt: objective,
    cliPrompt: buildPlannerPrompt(objective),
    cwd: process.cwd(),
    // Remember the install target on the run so chat cards reuse it. The
    // planner CLI itself stays in the app cwd and does not lock the worktree.
    workspaceId,
    lockWorkspace: false,
    trigger: 'planner',
  })

  // Poll the run row until the process finishes (planner is synchronous UX).
  const raw = await waitForRun(runId, 180_000)
  const proposals = parsePlanProposals(raw)
  return { proposals, raw, runId }
}

function waitForRun(runId: string, timeoutMs: number): Promise<string> {
  const db = getDb()
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      const row = db.prepare('SELECT status, stdout FROM runs WHERE id = ?').get(runId) as
        | { status: string; stdout: string }
        | undefined
      if (!row) return resolve('')
      if (row.status !== 'running' || Date.now() - start > timeoutMs) return resolve(row.stdout)
      setTimeout(tick, 400)
    }
    tick()
  })
}

/** Create one automation from a planner proposal; default arms the schedule. */
export function installPlanProposal(input: {
  runtimeId: string
  workspaceId: string
  proposal: PlanProposal
  /** Defaults to true (Save & activate). */
  enabled?: boolean
}): TaskWithMeta {
  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)
  const enabled = input.enabled !== false
  const cwd = resolveWorkspacePath(workspaceId)
  return upsertTask({
    name: input.proposal.name,
    description: input.proposal.description,
    runtimeId: input.runtimeId,
    prompt: input.proposal.prompt,
    cwd,
    workspaceId,
    cron: input.proposal.cron,
    enabled,
  })
}

export function createTasksFromPlan(input: {
  runtimeId: string
  workspaceId: string
  proposals: PlanProposal[]
  /** Defaults to false (batch create stays paused for review). */
  enabled?: boolean
}): TaskWithMeta[] {
  // Resolve once up front rather than per-proposal — a missing / not-ready
  // workspace should fail the whole batch, not silently create some tasks
  // with a stale cwd and others without.
  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)
  const enabled = input.enabled === true
  const cwd = resolveWorkspacePath(workspaceId)
  return input.proposals.map((p) =>
    upsertTask({
      name: p.name,
      description: p.description,
      runtimeId: input.runtimeId,
      prompt: p.prompt,
      cwd,
      workspaceId,
      cron: p.cron,
      enabled,
    }),
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export {
  deleteNotifier,
  getNotifier,
  listNotificationDeliveries,
  listNotifiers,
  testNotifier,
  upsertNotifier,
  type NotificationDeliveryListItem,
  type NotifierInput,
} from './notify'
export type { NotificationDeliveryRow, NotifierRow } from './db'

// ---------------------------------------------------------------------------
// Integrations (webhooks)
// ---------------------------------------------------------------------------

export {
  createIntegration,
  getIntegrationPublic,
  listDeliveriesForIntegration,
  listIntegrations,
  listProviderCatalog,
  listRecentDeliveries,
  rotateIntegrationSecret,
  updateIntegration,
  getInstallContext,
  type CreateIntegrationInput,
  type IntegrationPublic,
  type UpdateIntegrationInput,
  type InstallContext,
  type InstallIntegrationResult,
} from './integrations'
import {
  cleanupRemoteWebhook,
  deleteIntegration as deleteIntegrationRow,
  installIntegration as installIntegrationRow,
  type InstallIntegrationResult as InstallResult,
} from './integrations'
import type { InstallIntegrationInput } from '../lib/integrations/install'

export function deleteIntegration(integrationId: string) {
  cleanupRemoteWebhook(integrationId)
  deleteIntegrationRow(integrationId)
}

/** One-click install: local endpoint, optional remote webhook + automation. */
export async function installIntegration(input: InstallIntegrationInput): Promise<InstallResult> {
  return installIntegrationRow(input, {
    createAutomation: (args) => {
      const task = upsertTask({
        name: args.name,
        description: args.description,
        runtimeId: args.runtimeId,
        prompt: args.prompt,
        cwd: '',
        workspaceId: args.workspaceId,
        cron: '',
        enabled: args.enabled,
        webhookIntegrationId: args.webhookIntegrationId,
        webhookEvents: args.webhookEvents,
        webhookFilters: {},
      })
      return { id: task.id }
    },
  })
}

// ---------------------------------------------------------------------------
// Mobile devices — pairing and revocation for the iOS client. The mobile HTTP
// surface itself lives in `routes/api/mobile/**` and reaches the app through
// this facade like everything else.
// ---------------------------------------------------------------------------

export {
  activePairing,
  cancelPairing,
  createPairingCode,
  deleteDevice,
  getDevice,
  listDevices,
  revokeDevice,
  type PairingCode,
} from './mobile/devices'
export { MOBILE_ENABLE_HINT, MOBILE_ENV_VAR, mobileEnabled } from './mobile/config'
export { lanBaseUrls } from './mobile/lan'
export { apnsConfigured } from './mobile/apns'
export { mobileStatus } from './mobile/status'
export type { DeviceRow, DevicePairingRow } from './db'

// ---------------------------------------------------------------------------
// Cloud control plane (optional). Local features never consult this.
// ---------------------------------------------------------------------------

export {
  afterSignIn,
  bootCloud,
  completeCloudLogin,
  completeHostedJiraConnect,
  getCloudStatus,
  ingestTestEvent,
  signOutAndDisconnect,
  startCloudLogin,
  startJiraConnect,
} from './cloud'
export type { CloudStatus } from '../lib/cloud/types.ts'
