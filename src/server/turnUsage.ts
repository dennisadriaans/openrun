/**
 * Where a runtime's live token counts land.
 *
 * The adapters in `lib/agentEvents/` emit a transient `usage` event whenever a
 * CLI says something about its own context. It is a gauge, not transcript
 * content, so it never becomes a `turn_events` row: the sink below folds each
 * snapshot onto the message and pushes the merged value to open tails.
 */
import type Database from 'better-sqlite3'
import { mergeTurnUsage, type TurnUsage } from '../lib/turnUsage.ts'
import { publishRunLive } from './runLive'

export type TurnUsageSink = (frame: Partial<TurnUsage> | undefined) => void

export function createTurnUsageSink(
  db: Database.Database,
  runId: string,
  messageId: string,
): TurnUsageSink {
  const update = db.prepare('UPDATE messages SET usage = ? WHERE id = ?')
  let latest: TurnUsage | null = null

  return (frame) => {
    if (!frame) return
    latest = mergeTurnUsage(latest, frame)
    update.run(JSON.stringify(latest), messageId)
    publishRunLive(runId, { type: 'turn_usage', messageId, usage: latest })
  }
}
