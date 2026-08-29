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
import { queueDecision, type PendingEntry, type QueueTrigger } from '../lib/runQueue.ts'
import { publishActivityLive } from './activityLive.ts'
import { getDb, type RunQueueRow, type RuntimeRow, type TaskRow } from './db.ts'
import { runTask, type MessageSource } from './executor.ts'
import { isShuttingDown } from './processControl.ts'
import { checkRuntimeInstalled } from './runtimePath.ts'
import { settleScheduleFire } from './scheduleFires.ts'
import { unattendedRefusalFor } from './unattendedPreflight.ts'
import { checkWorkspace } from './workspaceHealth.ts'

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

export type EnqueueResult = { queued: true; position: number } | { queued: false; reason: string }

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
  source?: MessageSource
  scheduleFireId?: string
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
      `INSERT INTO run_queue (id, taskId, workspaceId, trigger, prompt, sourceProvider, sourceUrl, sourceLabel, scheduleFireId, queuedAt)
       VALUES (@id, @taskId, @workspaceId, @trigger, @prompt, @sourceProvider, @sourceUrl, @sourceLabel, @scheduleFireId, @queuedAt)`,
    )
    .run({
      id: id(),
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      trigger: input.trigger,
      prompt: input.prompt ?? '',
      sourceProvider: input.source?.provider ?? '',
      sourceUrl: input.source?.url ?? '',
      sourceLabel: input.source?.label ?? '',
      scheduleFireId: input.scheduleFireId ?? '',
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
  const queued = db
    .prepare('SELECT workspaceId, scheduleFireId FROM run_queue WHERE taskId = ?')
    .all(taskId) as Array<{ workspaceId: string; scheduleFireId: string }>
  db.prepare('DELETE FROM run_queue WHERE taskId = ?').run(taskId)
  for (const row of queued) {
    settleScheduleFire(row.scheduleFireId, {
      outcome: 'skipped',
      detail: 'Queued fire was cancelled when the automation was paused or deleted.',
    })
  }
  for (const workspaceId of new Set(queued.map((row) => row.workspaceId))) {
    publishDepth(workspaceId)
  }
}

export function dequeueEntry(entryId: string): void {
  const db = getDb()
  const row = db
    .prepare('SELECT workspaceId, scheduleFireId FROM run_queue WHERE id = ?')
    .get(entryId) as { workspaceId: string; scheduleFireId: string } | undefined
  removeEntry(entryId)
  if (row) {
    settleScheduleFire(row.scheduleFireId, {
      outcome: 'skipped',
      detail: 'Queued fire was removed before it started.',
    })
    publishDepth(row.workspaceId)
  }
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

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(entry.taskId) as
      | TaskRow
      | undefined
    // Deleted, empty prompt, or pointed at a workspace / runtime that is no
    // longer usable while it waited — drop it and try the next entry.
    // Disabled recurring tasks drop too. A fire-once task that was paused
    // *because* it already fired must still drain: the queue entry is that fire.
    if (!task) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'skipped',
        detail: 'Automation was deleted while this fire was queued.',
      })
      continue
    }
    if (!task.enabled && !task.fireOnce) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'skipped',
        detail: 'Automation was paused while this fire was queued.',
      })
      continue
    }
    if (!hasTaskPrompt(task.prompt) && !entry.prompt.trim()) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'failed',
        detail: 'Agent instructions became empty while this fire was queued.',
      })
      continue
    }
    // A queued fire waited precisely because another run was using this
    // worktree — so re-inspect it here rather than trusting the state it was
    // in when the fire came due. The run that just finished is exactly the one
    // that may have switched its branch or left it dirty.
    const checked = checkWorkspace(workspaceId)
    if (!checked || !isWorkspaceReady(checked.workspace.status)) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'failed',
        detail: 'Workspace became unavailable while this fire was queued.',
      })
      continue
    }

    const runtime = db.prepare('SELECT * FROM runtimes WHERE id = ?').get(task.runtimeId) as
      | RuntimeRow
      | undefined
    if (!runtime || !checkRuntimeInstalled(runtime.bin).installed) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'failed',
        detail: 'Runtime became unavailable while this fire was queued.',
      })
      continue
    }

    const unattended = unattendedRefusalFor({
      task,
      runtime,
      workspace: checked.workspace,
      health: checked.health,
    })
    if (unattended) {
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, { outcome: 'failed', detail: unattended })
      continue
    }

    try {
      const runId = runTask(
        task,
        runtime,
        entry.trigger === 'webhook' ? 'webhook' : 'schedule',
        entry.prompt || undefined,
        entry.sourceUrl
          ? {
              provider: entry.sourceProvider,
              url: entry.sourceUrl,
              label: entry.sourceLabel,
            }
          : undefined,
      )
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, { outcome: 'started', runId })
      return
    } catch (err) {
      // Something else may have grabbed the workspace between the check and
      // startRun. Keep the entry in that case; any other refusal is terminal
      // and becomes visible in the fire audit instead of disappearing.
      if (workspaceBusy(workspaceId)) return
      removeEntry(entry.id)
      publishDepth(workspaceId)
      settleScheduleFire(entry.scheduleFireId, {
        outcome: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
      console.error(`[queue] failed to start queued run for task ${entry.taskId}:`, err)
    }
  }
}

/**
 * Drain every workspace with pending entries. Called at boot so a queue left
 * behind by a crash or restart is not stranded until the next cron tick.
 */
export function drainAllQueues(): void {
  const workspaces = getDb().prepare('SELECT DISTINCT workspaceId FROM run_queue').all() as Array<{
    workspaceId: string
  }>
  for (const row of workspaces) {
    try {
      drainWorkspace(row.workspaceId)
    } catch (err) {
      console.error(`[queue] drain failed for workspace ${row.workspaceId}:`, err)
    }
  }
}
