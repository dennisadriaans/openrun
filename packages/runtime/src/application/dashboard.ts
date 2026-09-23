/** dashboard capability implementation. */
import { getDb } from '../storage/db.ts'
import { listTasks } from './taskQueries.ts'

import { listRuns } from './runs.ts'
import { listPendingRuns } from './taskCommands.ts'

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
  // Include task identity and run settings for the CLI's live activity rows.
  const activeRuns = db
    .prepare(
      "SELECT id, taskId, taskName, status, startedAt, model, effort FROM runs WHERE status = 'running' ORDER BY startedAt ASC",
    )
    .all() as {
    id: string
    taskId: string | null
    taskName: string
    status: string
    startedAt: number
    model: string
    effort: string
  }[]
  const running = activeRuns.length

  const upcoming = scheduled
    .slice()
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))
    .slice(0, 6)

  const recentRuns = listRuns({ limit: 8 })
  const runIds = [...new Set([...activeRuns, ...recentRuns].map((run) => run.id))]
  const prompts = new Map(
    runIds.length
      ? (
          db
            .prepare(
              `SELECT r.id, (SELECT content FROM messages
                 WHERE runId = r.id AND role = 'user'
                 ORDER BY createdAt ASC LIMIT 1) AS prompt
               FROM runs r WHERE r.id IN (${runIds.map(() => '?').join(',')})`,
            )
            .all(...runIds) as { id: string; prompt: string | null }[]
        ).map((run) => [run.id, run.prompt ?? ''])
      : [],
  )

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
    recentRuns: recentRuns.map((run) => ({ ...run, prompt: prompts.get(run.id) ?? '' })),
    activeRuns: activeRuns.map((run) => ({ ...run, prompt: prompts.get(run.id) ?? '' })),
    pending: listPendingRuns(),
  }
}
