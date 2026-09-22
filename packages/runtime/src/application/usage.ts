/** usage capability implementation. */
import { getDb } from '../storage/db.ts'
import { checkRuntimeInstalled } from '../runtimes/runtimePath.ts'
import { collectUsage } from '../runtimes/usage.ts'
import { parseUsageRange, rangeCutoff, type UsageReport } from '@openrun/domain/runtimes/usage'
import { listRuntimes } from './runtimes.ts'

/**
 * What every configured runtime has spent, read from each CLI's own history.
 * Runtimes are listed even when their binary is missing, so the page shows the
 * same roster as Runtimes rather than silently dropping rows.
 *
 * Worktrees are passed in alongside their project so a session started in a
 * worktree is credited to the project it belongs to, not to a stray folder.
 */
export function getUsageReport(input?: { range?: string }): UsageReport {
  const range = parseUsageRange(input?.range)
  const runtimes = listRuntimes().map((r) => ({
    id: r.id,
    label: r.label,
    bin: r.bin,
    transport: r.transport,
    installed: checkRuntimeInstalled(r.bin).installed,
  }))

  const db = getDb()
  const projectRows = db.prepare('SELECT id, name, path FROM projects').all() as Array<{
    id: string
    name: string
    path: string
  }>
  const worktreeRows = db
    .prepare(
      `SELECT w.projectId AS id, p.name AS name, w.path AS path
       FROM workspaces w JOIN projects p ON p.id = w.projectId`,
    )
    .all() as Array<{ id: string; name: string; path: string }>

  const cutoff = rangeCutoff(range, Date.now())
  const runCounts: Record<string, number> = {}
  const counted = db
    .prepare('SELECT runtimeId, COUNT(*) AS n FROM runs WHERE startedAt >= ? GROUP BY runtimeId')
    .all(cutoff) as Array<{ runtimeId: string; n: number }>
  for (const row of counted) runCounts[row.runtimeId] = row.n

  return collectUsage({
    runtimes,
    projects: [...projectRows, ...worktreeRows],
    range,
    runCounts,
  })
}

export { readUsagePressure as getUsagePressure } from '../runtimes/usage.ts'
