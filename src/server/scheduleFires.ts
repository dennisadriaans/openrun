import { randomUUID } from 'node:crypto'
import { publishActivityLive } from './activityLive.ts'
import { getDb, type ScheduleFireOutcome, type ScheduleFireRow } from './db.ts'
import { notifyScheduleFireRefused } from './notify.ts'

/** The fire recorded before `excludeId`, used to de-duplicate refusal alerts. */
function previousFire(
  taskId: string,
  excludeId: string,
): { outcome: string; detail: string } | null {
  const row = getDb()
    .prepare(
      `SELECT outcome, detail FROM schedule_fires
       WHERE taskId = ? AND id != ?
       ORDER BY observedAt DESC, rowid DESC LIMIT 1`,
    )
    .get(taskId, excludeId) as { outcome: string; detail: string } | undefined
  return row ?? null
}

export function recordScheduleFire(input: {
  taskId: string
  scheduledFor: number
  outcome: ScheduleFireOutcome
  runId?: string
  detail?: string
}): ScheduleFireRow {
  const row: ScheduleFireRow = {
    id: `fire_${randomUUID()}`,
    taskId: input.taskId,
    scheduledFor: input.scheduledFor,
    observedAt: Date.now(),
    outcome: input.outcome,
    runId: input.runId ?? '',
    detail: input.detail ?? '',
  }
  getDb()
    .prepare(
      `INSERT INTO schedule_fires (id, taskId, scheduledFor, observedAt, outcome, runId, detail)
       VALUES (@id, @taskId, @scheduledFor, @observedAt, @outcome, @runId, @detail)`,
    )
    .run(row)
  // Enough history to diagnose repeated misses without letting a minutely
  // automation grow the local database forever.
  getDb()
    .prepare(
      `DELETE FROM schedule_fires
       WHERE taskId = ? AND rowid NOT IN (
         SELECT rowid FROM schedule_fires WHERE taskId = ? ORDER BY observedAt DESC, rowid DESC LIMIT 100
       )`,
    )
    .run(row.taskId, row.taskId)
  publishActivityLive({ type: 'task_changed', taskId: row.taskId })
  // A refused fire never becomes a run, so the run-finished notifier cannot
  // report it. Tell the same destinations here instead.
  notifyScheduleFireRefused({
    taskId: row.taskId,
    outcome: row.outcome,
    detail: row.detail,
    scheduledFor: row.scheduledFor,
    previous: previousFire(row.taskId, row.id),
  })
  return row
}

export function settleScheduleFire(
  fireId: string,
  input: { outcome: ScheduleFireOutcome; runId?: string; detail?: string },
): void {
  if (!fireId.trim()) return
  const db = getDb()
  const row = db.prepare('SELECT taskId FROM schedule_fires WHERE id = ?').get(fireId) as
    | { taskId: string }
    | undefined
  db.prepare(
    `UPDATE schedule_fires
       SET observedAt = ?, outcome = ?, runId = ?, detail = ?
       WHERE id = ?`,
  ).run(Date.now(), input.outcome, input.runId ?? '', input.detail ?? '', fireId)
  if (!row) return
  publishActivityLive({ type: 'task_changed', taskId: row.taskId })
  // A queued fire that settles as failed/missed was refused just as surely as
  // one refused up front.
  notifyScheduleFireRefused({
    taskId: row.taskId,
    outcome: input.outcome,
    detail: input.detail ?? '',
    scheduledFor: 0,
    previous: previousFire(row.taskId, fireId),
  })
}

/**
 * When this automation's schedule was last observed, or 0 when it never was.
 * The boot-time miss detector uses it as the start of the window it is
 * responsible for — anything older belongs to a previous install, not to us.
 */
export function lastFireObservedAt(taskId: string): number {
  const row = getDb()
    .prepare(
      'SELECT observedAt FROM schedule_fires WHERE taskId = ? ORDER BY observedAt DESC, rowid DESC LIMIT 1',
    )
    .get(taskId) as { observedAt: number } | undefined
  return row?.observedAt ?? 0
}

export function latestScheduleFires(taskIds?: string[]): Record<string, ScheduleFireRow> {
  if (taskIds && taskIds.length === 0) return {}
  const rows = getDb()
    .prepare(
      `SELECT * FROM schedule_fires
       WHERE rowid IN (SELECT MAX(rowid) FROM schedule_fires GROUP BY taskId)`,
    )
    .all() as ScheduleFireRow[]
  const allowed = taskIds ? new Set(taskIds) : null
  const out: Record<string, ScheduleFireRow> = {}
  for (const row of rows) {
    if (allowed && !allowed.has(row.taskId)) continue
    if (!out[row.taskId]) out[row.taskId] = row
  }
  return out
}
