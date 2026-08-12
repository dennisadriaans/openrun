/**
 * Pending-run queue.
 *
 * A workspace runs one agent at a time. When a cron tick or a webhook arrives
 * while the workspace is busy, the fire is parked here and started when the
 * current run finishes, instead of being thrown away with a console log.
 *
 * Policy (what queues, what coalesces, what gets dropped) lives in
 * `lib/runQueue.ts`; this module owns the table and the draining.
 */
import { hasTaskPrompt } from '../lib/taskPrompt.ts'
import { isWorkspaceReady } from '../lib/workspaceReady.ts'
import {
  queueDecision,
  type PendingEntry,
  type QueueTrigger,
} from '../lib/runQueue.ts'
import { publishActivityLive } from './activityLive.ts'
import { getDb, type RunQueueRow, type RuntimeRow, type TaskRow } from './db.ts'
import { runTask } from './executor.ts'
import { isShuttingDown } from './processControl.ts'
import { checkRuntimeInstalled } from './runtimePath.ts'
import { getWorkspace } from './workspaces.ts'

function id(): string {
  return `q_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function listQueue(workspaceId?: string): RunQueueRow[] {
  const db = getDb()
  return (
    workspaceId
      ? db
        .prepare('SELECT * FROM run_queue WHERE workspaceId = ? ORDER BY queuedAt ASC')
        .all(workspaceId)
      : db.prepare('SELECT * FROM run_queue ORDER BY queuedAt ASC').all()
  ) as RunQueueRow[]
}

export function queueDepth(workspaceId: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM run_queue WHERE workspaceId = ?')
      .get(workspaceId) as { n: number }
  ).n
}

/** Pending depth per task id, for the Automations list. */
export function queueDepthByTask(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT taskId, COUNT(*) AS n FROM run_queue GROUP BY taskId')
    .all() as Array<{ taskId: string; n: number }>
  const out: Record<string, number> = {}
  for (const row of rows) out[row.taskId] = row.n
  return out
}

function publishDepth(workspaceId: string) {
  publishActivityLive({
    type: 'queue_changed',
    workspaceId,
    queued: queueDepth(workspaceId),
  })
}

export type EnqueueResult =
  | { queued: true; position: number }
  | { queued: false; reason: string }

/**
 * Park an unattended fire for a busy workspace. Returns why not when the entry
 * was coalesced into an existing one or dropped at the cap — callers log that
 * instead of pretending the trigger ran.
 */
export function enqueueRun(input: {
  taskId: string
  workspaceId: string
  trigger: QueueTrigger | string
  prompt?: string
}): EnqueueResult {
  const pending: PendingEntry[] = listQueue(input.workspaceId).map((row) => ({
    taskId: row.taskId,
    trigger: row.trigger,
  }))

  const decision = queueDecision({
    taskId: input.taskId,
    trigger: input.trigger,
    pending,
  })
  if (decision.action === 'refuse') {
    return { queued: false, reason: 'This workspace already has a run in progress' }
  }
  if (decision.action !== 'enqueue') {
    return { queued: false, reason: decision.reason }
  }

  getDb()
    .prepare(
      `INSERT INTO run_queue (id, taskId, workspaceId, trigger, prompt, queuedAt)
       VALUES (@id, @taskId, @workspaceId, @trigger, @prompt, @queuedAt)`,
    )
    .run({
      id: id(),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      prompt: input.prompt ?? '',
      queuedAt: Date.now(),
    })

  const position = queueDepth(input.workspaceId)
  publishDepth(input.workspaceId)
  return { queued: true, position }
}

function removeEntry(entryId: string) {
  getDb().prepare('DELETE FROM run_queue WHERE id = ?').run(entryId)
}

export function clearQueueForTask(taskId: string): void {
  const db = getDb()
  const affected = db
    .prepare('SELECT DISTINCT workspaceId FROM run_queue WHERE taskId = ?')
    .all(taskId) as Array<{ workspaceId: string }>
  db.prepare('DELETE FROM run_queue WHERE taskId = ?').run(taskId)
  for (const row of affected) publishDepth(row.workspaceId)
}

export function dequeueEntry(entryId: string): void {
  const db = getDb()
  const row = db.prepare('SELECT workspaceId FROM run_queue WHERE id = ?').get(entryId) as
    | { workspaceId: string }
    | undefined
  removeEntry(entryId)
  if (row) publishDepth(row.workspaceId)
}

function workspaceBusy(workspaceId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running' LIMIT 1")
    .get(workspaceId) as { id: string } | undefined
  return Boolean(row)
}

/**
 * Start the oldest pending entry for a workspace, if it is free. Entries whose
 * task, workspace or runtime has since become unusable are discarded rather
 * than retried forever — the same gates that refuse a fresh run apply here.
 */
export function drainWorkspace(workspaceId: string): void {
  if (!workspaceId.trim()) return
  // SIGINT/SIGTERM path sets this so a cancelled run's finalize hook cannot
  // spawn a replacement agent as the process is exiting.
  if (isShuttingDown()) return

  const db = getDb()
  // One at a time — the next entry drains when this run finalizes.
  while (!workspaceBusy(workspaceId)) {
    const entry = db
      .prepare('SELECT * FROM run_queue WHERE workspaceId = ? ORDER BY queuedAt ASC LIMIT 1')
      .get(workspaceId) as RunQueueRow | undefined
    if (!entry) return

    removeEntry(entry.id)
    publishDepth(workspaceId)

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(entry.taskId) as
      | TaskRow
      | undefined
    // Deleted, disabled, empty prompt, or pointed at a workspace / runtime that
    // is no longer usable while it waited — drop it and try the next entry.
    // Same gates the scheduler applies before arming a fresh tick.
    if (!task || !task.enabled) continue
    if (!hasTaskPrompt(task.prompt) && !entry.prompt.trim()) continue
    const workspace = getWorkspace(workspaceId)
    if (!workspace || !isWorkspaceReady(workspace.status)) continue

    const runtime = db.prepare('SELECT * FROM runtimes WHERE id = ?').get(task.runtimeId) as
      | RuntimeRow
      | undefined
    if (!runtime || !checkRuntimeInstalled(runtime.bin).installed) continue

    try {
      runTask(
        task,
        runtime,
        entry.trigger === 'webhook' ? 'webhook' : 'schedule',
        entry.prompt || undefined,
      )
      return
    } catch (err) {
      // Something else grabbed the workspace between the check and the spawn,
      // or the run refused for a reason the gates above don't cover. Keep
      // going: the loop re-checks `workspaceBusy` and stops if it is taken.
      console.error(`[queue] failed to start queued run for task ${entry.taskId}:`, err)
    }
  }
}

/**
 * Drain every workspace with pending entries. Called at boot so a queue left
 * behind by a crash or restart is not stranded until the next cron tick.
 */
export function drainAllQueues(): void {
  const workspaces = getDb()
    .prepare('SELECT DISTINCT workspaceId FROM run_queue')
    .all() as Array<{ workspaceId: string }>
  for (const row of workspaces) {
    try {
      drainWorkspace(row.workspaceId)
    } catch (err) {
      console.error(`[queue] drain failed for workspace ${row.workspaceId}:`, err)
    }
  }
}
