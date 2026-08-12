/**
 * Shared live-run stream shapes (SSE payload). Kept outside `server/` so the
 * client can type EventSource messages without importing Node modules.
 */

import type { TurnEventKind, TurnEventPayload } from './turnEvents'
import type { RunVerdict } from './verdict'

export type RunLiveLogStream = 'stdout' | 'stderr'

/**
 * A settled check as it crosses the wire. Mirrors the `check_results` row but
 * typed here so the client never imports a server module.
 */
export type CheckResultFrame = {
  id: string
  runId: string
  messageId: string
  attempt: number
  checkId: string
  name: string
  command: string
  outcome: string
  exitCode: number | null
  output: string
  durationMs: number
  startedAt: number
  finishedAt: number | null
}

export type RunLiveEvent =
  | { type: 'hello'; runId: string; status: string }
  | { type: 'ping' }
  | { type: 'log'; stream: RunLiveLogStream; chunk: string; messageId: string }
  | {
      type: 'turn_event'
      id: string
      messageId: string
      runId: string
      seq: number
      kind: TurnEventKind
      payload: TurnEventPayload
      createdAt: number
    }
  | {
      type: 'turn_started'
      userMessageId: string
      assistantMessageId: string
      prompt: string
      createdAt: number
    }
  | { type: 'status'; status: string; exitCode: number | null }
  | {
      type: 'check_started'
      id: string
      runId: string
      messageId: string
      attempt: number
      checkId: string
      name: string
      command: string
      startedAt: number
    }
  | { type: 'check_finished'; result: CheckResultFrame }
  /** Verification finished for the run — the final judgement. */
  | { type: 'verdict'; verdict: RunVerdict; repairAttempts: number }
  /** A repair turn is about to start after red checks. */
  | { type: 'repair_started'; attempt: number; maxAttempts: number }

/** Path the browser EventSource connects to for a run's live tail. */
export function runLiveStreamPath(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/stream`
}
