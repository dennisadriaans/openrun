/**
 * Follow-up message queue.
 *
 * Messages typed while the agent is mid-turn are parked here and delivered —
 * one turn each, oldest first — when the run frees up. Policy (the cap, the
 * copy) lives in `lib/messageQueue.ts`; this module owns the table and the
 * frames the chat UI listens to.
 *
 * Draining lives in `executor.ts`, which is the only module allowed to start a
 * turn; keeping it out of here is what stops the two from importing each other.
 */
import { queueMessageDecision, type QueuedMessage } from '../lib/messageQueue.ts'
import { getDb, type MessageQueueRow } from './db.ts'
import { publishRunLive } from './runLive.ts'

function id(): string {
  return `mq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function listQueuedMessages(runId: string): QueuedMessage[] {
  return getDb()
    .prepare('SELECT * FROM message_queue WHERE runId = ? ORDER BY queuedAt ASC, id ASC')
    .all(runId) as MessageQueueRow[]
}

export function queuedMessageDepth(runId: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM message_queue WHERE runId = ?')
      .get(runId) as { n: number }
  ).n
}

/** Push the run's queue to every open transcript. */
export function publishQueue(runId: string): void {
  publishRunLive(runId, { type: 'queue_changed', queued: listQueuedMessages(runId) })
}

export type EnqueueMessageResult =
  | { queued: true; id: string; position: number }
  | { queued: false; reason: string }

export function enqueueMessage(input: {
  runId: string
  prompt: string
  model?: string
  effort?: string
  runtimeMode?: string
  runtimeId?: string
}): EnqueueMessageResult {
  const decision = queueMessageDecision(queuedMessageDepth(input.runId))
  if (decision.action === 'drop') return { queued: false, reason: decision.reason }

  const entryId = id()
  getDb()
    .prepare(
      `INSERT INTO message_queue (id, runId, prompt, model, effort, runtimeMode, runtimeId, queuedAt)
       VALUES (@id, @runId, @prompt, @model, @effort, @runtimeMode, @runtimeId, @queuedAt)`,
    )
    .run({
      id: entryId,
      runId: input.runId,
      prompt: input.prompt,
      model: input.model ?? '',
      effort: input.effort ?? '',
      runtimeMode: input.runtimeMode ?? '',
      runtimeId: input.runtimeId ?? '',
      queuedAt: Date.now(),
    })

  const position = queuedMessageDepth(input.runId)
  publishQueue(input.runId)
  return { queued: true, id: entryId, position }
}

/** The next message to deliver, without removing it. */
export function peekQueuedMessage(runId: string): QueuedMessage | undefined {
  return getDb()
    .prepare('SELECT * FROM message_queue WHERE runId = ? ORDER BY queuedAt ASC, id ASC LIMIT 1')
    .get(runId) as MessageQueueRow | undefined
}

export function removeQueuedMessage(entryId: string): void {
  const db = getDb()
  const row = db.prepare('SELECT runId FROM message_queue WHERE id = ?').get(entryId) as
    | { runId: string }
    | undefined
  if (!row) return
  db.prepare('DELETE FROM message_queue WHERE id = ?').run(entryId)
  publishQueue(row.runId)
}

export function clearQueuedMessages(runId: string): void {
  getDb().prepare('DELETE FROM message_queue WHERE runId = ?').run(runId)
  publishQueue(runId)
}
