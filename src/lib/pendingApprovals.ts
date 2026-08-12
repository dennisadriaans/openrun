/**
 * Which supervised approval requests are still waiting for a human decision.
 *
 * There is no pending-approvals table: the executor keeps its live timers in
 * memory (`approvalTimers`) and only persists `approval_request` /
 * `approval_resolved` turn events. So "what is pending" is always *derived*
 * from the event log, and it has to be derived the same way in two places —
 * the desktop chat transcript and the mobile API. This module is that one
 * derivation, so the two can never disagree.
 *
 * Browser-safe: no `node:` imports, no DB access.
 */
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'

/** A tool-approval request the agent is still blocked on. */
export type PendingApproval = {
  requestId: string
  /** Tool the agent asked to use; 'tool' when the payload omitted a name. */
  toolName: string
  /** Raw tool input, for rendering the "what will it do" detail. */
  input: unknown
  /** When the request event was recorded (ms epoch). */
  createdAt: number
}

/** Tolerant payload parse — a malformed row must not break the transcript. */
function payloadOf(ev: TurnEventRow): TurnEventPayload {
  try {
    return JSON.parse(ev.payload) as TurnEventPayload
  } catch {
    return {}
  }
}

/**
 * Approval requests with no matching `approval_resolved`, oldest first.
 *
 * Events without a `requestId` are skipped: the control protocol correlates
 * request and resolution by that id, so one without it can never be answered.
 * Duplicate requestIds collapse to the first occurrence — the executor
 * schedules one timer per id (`scheduleApprovalTimeout` returns early when the
 * id is already tracked), so a repeat is a re-emission, not a second prompt.
 */
export function pendingApprovals(
  events: readonly TurnEventRow[],
): PendingApproval[] {
  const resolved = new Set<string>()
  for (const ev of events) {
    if (ev.kind !== 'approval_resolved') continue
    const requestId = payloadOf(ev).requestId
    if (requestId) resolved.add(requestId)
  }

  const pending: PendingApproval[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    if (ev.kind !== 'approval_request') continue
    const payload = payloadOf(ev)
    const requestId = payload.requestId
    if (!requestId || resolved.has(requestId) || seen.has(requestId)) continue
    seen.add(requestId)
    pending.push({
      requestId,
      toolName: payload.name || 'tool',
      input: payload.input,
      createdAt: ev.createdAt,
    })
  }
  return pending
}

/** True when the run is blocked on at least one unanswered approval. */
export function hasPendingApproval(events: readonly TurnEventRow[]): boolean {
  return pendingApprovals(events).length > 0
}

/** Request ids already answered — what the transcript needs to stop offering buttons. */
export function resolvedApprovalIds(
  events: readonly TurnEventRow[],
): Set<string> {
  const resolved = new Set<string>()
  for (const ev of events) {
    if (ev.kind !== 'approval_resolved') continue
    const requestId = payloadOf(ev).requestId
    if (requestId) resolved.add(requestId)
  }
  return resolved
}
