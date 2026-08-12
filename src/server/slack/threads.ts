/**
 * Slack thread ↔ run binding.
 *
 * This is the small piece of state that makes the integration feel like a
 * conversation instead of a command line: once a run has been announced in a
 * thread, a bare reply in that thread is routed to that run as its next turn,
 * exactly like typing in the desktop chat panel.
 */
import { getDb, type SlackThreadRow } from '../db.ts'

/** Bind a thread to a run. Re-binding the same thread is a no-op. */
export function bindThread(input: { channelId: string; threadTs: string; runId: string }): void {
  if (!input.channelId || !input.threadTs || !input.runId) return
  getDb()
    .prepare(
      `INSERT INTO slack_threads (threadTs, channelId, runId, createdAt)
       VALUES (@threadTs, @channelId, @runId, @createdAt)
       ON CONFLICT(channelId, threadTs) DO UPDATE SET runId = excluded.runId`,
    )
    .run({ ...input, createdAt: Date.now() })
}

/** Which run does this thread steer, if any? */
export function runForThread(channelId: string, threadTs: string): string | undefined {
  if (!channelId || !threadTs) return undefined
  const row = getDb()
    .prepare('SELECT runId FROM slack_threads WHERE channelId = ? AND threadTs = ?')
    .get(channelId, threadTs) as { runId: string } | undefined
  return row?.runId
}

/**
 * The thread a run already owns, so follow-up announcements (finished, an
 * approval prompt) land in the same place instead of starting a new thread.
 */
export function threadForRun(runId: string): SlackThreadRow | undefined {
  if (!runId) return undefined
  return getDb()
    .prepare('SELECT * FROM slack_threads WHERE runId = ? ORDER BY createdAt DESC LIMIT 1')
    .get(runId) as SlackThreadRow | undefined
}

/**
 * Drop bindings for runs that no longer exist, plus anything older than the
 * retention window. Slack threads go cold long before the table gets big; this
 * exists so deleting a run does not leave a thread pointing at nothing.
 */
export function pruneThreads(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
  const db = getDb()
  const cutoff = Date.now() - maxAgeMs
  const result = db
    .prepare(
      `DELETE FROM slack_threads
       WHERE createdAt < ?
          OR runId NOT IN (SELECT id FROM runs)`,
    )
    .run(cutoff)
  return result.changes
}
