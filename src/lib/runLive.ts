/**
 * Shared live-run stream shapes (SSE payload). Kept outside `server/` so the
 * client can type EventSource messages without importing Node modules.
 */

import type { QueuedMessage } from './messageQueue'
import type { TurnEventKind, TurnEventPayload } from './turnEvents'
import type { TurnUsage } from './turnUsage'
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
  /**
   * Token accounting for the running turn, folded onto the message row. Sent
   * as its own frame rather than a `turn_event` because it is a gauge that
   * replaces itself, not a transcript row that appends.
   */
  | { type: 'turn_usage'; messageId: string; usage: TurnUsage }
  | {
      type: 'turn_started'
      userMessageId: string
      assistantMessageId: string
      prompt: string
      createdAt: number
    }
  /**
   * One turn's assistant message settled. Published before the run itself
   * goes terminal — verification and a repair turn may still follow — so the
   * transcript can drop its working indicator without waiting for `status`.
   */
  | {
      type: 'turn_finished'
      messageId: string
      status: 'success' | 'error' | 'cancelled'
      exitCode: number | null
      content: string
      /** Parsed `DiffFile[]`; typed loosely to keep `lib/` server-free. */
      diffSummary: unknown[]
      finishedAt: number
    }
  | { type: 'status'; status: string; exitCode: number | null; canFollowUp?: boolean }
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
  /**
   * The run's queued follow-ups changed — sent whole rather than as a delta so
   * a transcript that missed a frame still converges.
   */
  | { type: 'queue_changed'; queued: QueuedMessage[] }

/** Path the browser EventSource connects to for a run's live tail. */
export function runLiveStreamPath(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/stream`
}
