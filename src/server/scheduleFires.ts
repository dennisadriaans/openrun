import { randomUUID } from 'node:crypto'
import { publishActivityLive } from './activityLive.ts'
import { getDb, type ScheduleFireOutcome, type ScheduleFireRow } from './db.ts'

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
  if (row) publishActivityLive({ type: 'task_changed', taskId: row.taskId })
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
