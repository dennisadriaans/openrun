/**
 * Turns typed from Slack while a run was still working.
 *
 * `sendFollowUp` refuses to resume a run that is mid-turn — the workspace is
 * locked and the CLI owns stdin. On a phone, though, "actually skip the tests"
 * is precisely what you want to say *while* it is busy. So the message is
 * parked here and flushed by the run-finalized hook.
 *
 * Everything is keyed by run and drained in one shot: several queued lines are
 * joined into a single follow-up so the agent gets one coherent instruction
 * rather than a burst of separate turns.
 */
import { getDb, type SlackPendingTurnRow } from '../db.ts'

function id(): string {
  return `sqt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Cap so a stuck run cannot accumulate an unbounded prompt. */
const MAX_QUEUED_PER_RUN = 20

export function queueTurn(input: {
  runId: string
  text: string
  channelId?: string
  threadTs?: string
  userId?: string
}): { queued: number } {
  const db = getDb()
  const existing = countQueued(input.runId)
  if (existing >= MAX_QUEUED_PER_RUN) {
    throw new Error(`Already holding ${existing} queued messages for this run.`)
  }
  db.prepare(
    `INSERT INTO slack_pending_turns (id, runId, text, channelId, threadTs, userId, createdAt)
     VALUES (@id, @runId, @text, @channelId, @threadTs, @userId, @createdAt)`,
  ).run({
    id: id(),
    runId: input.runId,
    text: input.text,
    channelId: input.channelId ?? '',
    threadTs: input.threadTs ?? '',
    userId: input.userId ?? '',
    createdAt: Date.now(),
  })
  return { queued: existing + 1 }
}

export function countQueued(runId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM slack_pending_turns WHERE runId = ?')
    .get(runId) as { n: number }
  return row.n
}

export function listQueued(runId: string): SlackPendingTurnRow[] {
  return getDb()
    .prepare('SELECT * FROM slack_pending_turns WHERE runId = ? ORDER BY createdAt ASC')
    .all(runId) as SlackPendingTurnRow[]
}

/**
 * Remove and return everything queued for a run.
 *
 * Deleting *before* the follow-up is attempted is deliberate: if the resume
 * throws, we would otherwise retry the same prompt on every subsequent finalize
 * and the run could never settle.
 */
export function drainQueued(runId: string): SlackPendingTurnRow[] {
  const db = getDb()
  const rows = listQueued(runId)
  if (rows.length > 0) db.prepare('DELETE FROM slack_pending_turns WHERE runId = ?').run(runId)
  return rows
}

export function clearQueued(runId: string): number {
  return getDb().prepare('DELETE FROM slack_pending_turns WHERE runId = ?').run(runId).changes
}

/** Join queued lines into one prompt, preserving the order they were typed. */
export function mergeQueued(rows: readonly SlackPendingTurnRow[]): string {
  return rows
    .map((r) => r.text.trim())
    .filter(Boolean)
    .join('\n\n')
}
