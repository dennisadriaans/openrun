/** runs capability implementation. */
import { resolveRuntimeLabel } from '@openrun/domain/runtimes/runtimeLabel'
import { runActivitySummary, runListTitle } from '@openrun/domain/runs/runPreview'
import { getDb, type CheckResultRow, type RunRow } from '../storage/db.ts'
import {
  cancelRun as _cancelRun,
  drainMessageQueue,
  runChecksNow as _runChecksNow,
} from '../execution/executor.ts'
import { listCheckResults } from '../execution/checks.ts'
import {
  clearQueuedMessages,
  listQueuedMessages,
  removeQueuedMessage,
} from '../execution/messageQueue.ts'
import type { TurnEventRow } from '@openrun/domain/chat/turnEvents'
import { deleteRunsInTransaction } from '../execution/runDeletion.ts'
import { listRuntimes } from './runtimes.ts'

export type RunSummary = Omit<RunRow, 'stdout' | 'stderr'> & {
  stdoutBytes: number
  stderrBytes: number
  /** Display name from the runtime row; falls back to runtimeId when missing. */
  runtimeLabel: string
  /** First-prompt title for chats; the automation name otherwise. */
  chatTitle: string
  /** One-line activity: in-flight tool, or files the agent edited. */
  activitySummary: string
  /** Agent wrote something after the user last opened the run. */
  unread: boolean
  /** Hierarchy labels used by conversation navigation. Empty for legacy runs. */
  projectId: string
  projectName: string
  workspaceBranch: string
}

function runsListWhere(opts?: { taskId?: string; includeArchived?: boolean }): {
  where: string
  params: unknown[]
} {
  const archivedClause = opts?.includeArchived
    ? 'AND archivedAt IS NOT NULL'
    : 'AND archivedAt IS NULL'
  if (opts?.taskId) {
    return { where: `taskId = ? ${archivedClause}`, params: [opts.taskId] }
  }
  return { where: `1=1 ${archivedClause}`, params: [] }
}

export function countRuns(opts?: {
  taskId?: string
  /** When true, count archived runs only; default is active (non-archived) runs. */
  includeArchived?: boolean
}): number {
  const { where, params } = runsListWhere(opts)
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM runs WHERE ${where}`)
    .get(...params) as { n: number }
  return row.n
}

type RunListRow = Omit<RunRow, 'stdout' | 'stderr'> & {
  stdoutBytes: number
  stderrBytes: number
  projectId: string | null
  projectName: string | null
  workspaceBranch: string | null
}

function decorateRunSummaries(rows: RunListRow[]): RunSummary[] {
  const labelById = new Map(listRuntimes().map((runtime) => [runtime.id, runtime.label] as const))
  if (rows.length === 0) return []

  const ids = rows.map((row) => row.id)
  const placeholders = ids.map(() => '?').join(',')
  const db = getDb()
  const firstPrompt = new Map<string, string>()
  const promptRows = db
    .prepare(
      `SELECT runId, content FROM messages
       WHERE runId IN (${placeholders}) AND role = 'user'
       ORDER BY createdAt ASC`,
    )
    .all(...ids) as Array<{ runId: string; content: string }>
  for (const row of promptRows) {
    if (!firstPrompt.has(row.runId)) firstPrompt.set(row.runId, row.content)
  }

  const lastAgentAt = new Map<string, number>()
  const agentRows = db
    .prepare(
      `SELECT runId, MAX(createdAt) AS at FROM messages
       WHERE runId IN (${placeholders}) AND role = 'assistant'
       GROUP BY runId`,
    )
    .all(...ids) as Array<{ runId: string; at: number }>
  for (const row of agentRows) lastAgentAt.set(row.runId, row.at)

  const eventsByRun = new Map<string, Array<Pick<TurnEventRow, 'kind' | 'payload'>>>()
  const eventRows = db
    .prepare(
      `SELECT runId, kind, payload FROM turn_events
       WHERE runId IN (${placeholders})
         AND kind IN ('tool_start','tool_result','thought','plan','assistant','approval_request','approval_resolved')
       ORDER BY createdAt ASC, seq ASC`,
    )
    .all(...ids) as Array<{ runId: string; kind: TurnEventRow['kind']; payload: string }>
  for (const row of eventRows) {
    const list = eventsByRun.get(row.runId) ?? []
    list.push({ kind: row.kind, payload: row.payload })
    eventsByRun.set(row.runId, list)
  }

  return rows.map((row) => {
    const summary = runActivitySummary(eventsByRun.get(row.id) ?? [], {
      running: row.status === 'running' || row.status === 'queued',
    })
    return {
      ...row,
      runtimeLabel: resolveRuntimeLabel(labelById.get(row.runtimeId), row.runtimeId),
      chatTitle: runListTitle({
        trigger: row.trigger,
        taskName: row.taskName,
        prompt: firstPrompt.get(row.id) ?? '',
      }),
      activitySummary: summary ?? '',
      unread: (lastAgentAt.get(row.id) ?? 0) > row.lastReadAt,
      projectId: row.projectId ?? '',
      projectName: row.projectName ?? '',
      workspaceBranch: row.workspaceBranch ?? row.headBranch ?? row.baseBranch ?? '',
    }
  })
}

/** Task ids with a live run — cheap status dots for the automations list. */
export function listRunningTaskIds(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT taskId FROM runs
       WHERE status = 'running' AND taskId IS NOT NULL AND taskId != ''`,
    )
    .all() as Array<{ taskId: string }>
  return rows.map((row) => row.taskId)
}

export function listRuns(opts?: {
  taskId?: string
  limit?: number
  offset?: number
  /** When true, return archived runs only; default is active (non-archived) runs. */
  includeArchived?: boolean
}): RunSummary[] {
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  const { where, params } = runsListWhere(opts)
  const rows = getDb()
    .prepare(
      `WITH selected_runs AS (
         SELECT id, taskId, taskName, runtimeId, trigger, status, command, cwd, pid, exitCode,
                length(stdout) AS stdoutBytes, length(stderr) AS stderrBytes, startedAt, finishedAt,
                workspaceId, sessionId, baseBranch, headBranch, baseSnapshot, model, effort,
                runtimeMode, archivedAt, verdict, repairAttempts, timedOut, lastReadAt
         FROM runs WHERE ${where} ORDER BY startedAt DESC LIMIT ? OFFSET ?
       )
       SELECT r.*, w.projectId, p.name AS projectName, w.branch AS workspaceBranch
       FROM selected_runs r
       LEFT JOIN workspaces w ON w.id = r.workspaceId
       LEFT JOIN projects p ON p.id = w.projectId
       ORDER BY r.startedAt DESC`,
    )
    .all(...params, limit, offset) as RunListRow[]
  return decorateRunSummaries(rows)
}

export type ConversationNavigationRun = Pick<
  RunSummary,
  | 'id'
  | 'chatTitle'
  | 'runtimeId'
  | 'runtimeLabel'
  | 'startedAt'
  | 'workspaceId'
  | 'workspaceBranch'
  | 'projectId'
  | 'projectName'
  | 'unread'
>

/** Minimal, unpaginated conversation index for the global header navigator. */
export function listConversationNavigationRuns(): ConversationNavigationRun[] {
  const labelById = new Map(listRuntimes().map((runtime) => [runtime.id, runtime.label] as const))
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.runtimeId, r.trigger, r.taskName, r.startedAt, r.workspaceId,
              r.lastReadAt, w.branch AS workspaceBranch, w.projectId,
              p.name AS projectName,
              (SELECT content FROM messages
               WHERE runId = r.id AND role = 'user'
               ORDER BY createdAt ASC LIMIT 1) AS firstPrompt,
              (SELECT MAX(createdAt) FROM messages
               WHERE runId = r.id AND role = 'assistant') AS lastAgentAt
       FROM runs r
       LEFT JOIN workspaces w ON w.id = r.workspaceId
       LEFT JOIN projects p ON p.id = w.projectId
       WHERE r.archivedAt IS NULL
       ORDER BY r.startedAt DESC`,
    )
    .all() as Array<{
    id: string
    runtimeId: string
    trigger: string
    taskName: string | null
    startedAt: number
    workspaceId: string
    lastReadAt: number
    workspaceBranch: string | null
    projectId: string | null
    projectName: string | null
    firstPrompt: string | null
    lastAgentAt: number | null
  }>
  return rows.map((row) => ({
    id: row.id,
    chatTitle: runListTitle({
      trigger: row.trigger,
      taskName: row.taskName ?? '',
      prompt: row.firstPrompt ?? '',
    }),
    runtimeId: row.runtimeId,
    runtimeLabel: resolveRuntimeLabel(labelById.get(row.runtimeId), row.runtimeId),
    startedAt: row.startedAt,
    workspaceId: row.workspaceId,
    workspaceBranch: row.workspaceBranch ?? '',
    projectId: row.projectId ?? '',
    projectName: row.projectName ?? '',
    unread: (row.lastAgentAt ?? 0) > row.lastReadAt,
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

/** Clear the unread dot on the runs list; called when the run detail is open. */
export function markRunRead(runId: string): { ok: true } {
  getDb().prepare('UPDATE runs SET lastReadAt = ? WHERE id = ?').run(Date.now(), runId)
  return { ok: true }
}

export function cancelRun(runId: string) {
  _cancelRun(runId)
  return getRun(runId)
}

/**
 * Follow-ups parked while the agent was working. The queue drains itself when
 * the turn ends; these are the manual handles the transcript needs — drop one,
 * clear them all, or deliver them now on a run the user stopped.
 */
export function listQueuedFollowUps(runId: string) {
  return listQueuedMessages(runId)
}

export function dequeueFollowUp(input: { id: string }): { ok: true } {
  removeQueuedMessage(input.id)
  return { ok: true }
}

export function clearQueuedFollowUps(runId: string): { ok: true } {
  clearQueuedMessages(runId)
  return { ok: true }
}

/**
 * Deliver the queue now instead of waiting for the turn. A working agent is
 * interrupted first — the queue then drains once its process is gone, which is
 * what "send now" means everywhere else in the product.
 */
export function flushQueuedFollowUps(runId: string): { started: boolean } {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  if (listQueuedMessages(runId).length === 0) return { started: false }
  if (run.status === 'running') {
    _cancelRun(runId, { drainQueue: true })
    return { started: true }
  }
  return { started: drainMessageQueue(runId) }
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
  deleteRunsInTransaction(getDb(), [runId])
}

export function deleteRuns(runIds: string[]): void {
  deleteRunsInTransaction(getDb(), runIds)
}
