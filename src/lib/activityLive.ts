/**
 * Shared shapes for the app-wide activity SSE stream (list pages).
 * Kept outside `server/` so the client can type EventSource messages.
 */

import type { RunVerdict } from './verdict'

export type ActivityLiveEvent =
  | { type: 'hello' }
  | { type: 'ping' }
  /**
   * `verdict` is present once verification has settled; while a run is live it
   * is omitted so list pages keep showing the status badge alone.
   */
  | { type: 'run_changed'; runId: string; status: string; verdict?: RunVerdict }
  /** A run moved into or out of the pending queue for its workspace. */
  | { type: 'queue_changed'; workspaceId: string; queued: number }
  /**
   * A supervised run is blocked on a tool approval. Carried app-wide (not just
   * on the run's own stream) so list pages — and a phone that is not sitting on
   * the run — can surface it before `expiresAt`, after which the executor
   * auto-denies.
   */
  | {
      type: 'approval_pending'
      runId: string
      requestId: string
      toolName: string
      expiresAt: number
    }
  /** An approval was answered, or timed out into a deny. */
  | {
      type: 'approval_settled'
      runId: string
      requestId: string
      decision: 'allow' | 'deny'
    }

/** Path the browser EventSource connects to for list-page live updates. */
export function activityLiveStreamPath(): string {
  return '/api/activity/stream'
}

/**
 * React Query key prefixes list pages should invalidate for an activity frame.
 *
 * `ping` / `hello` keep the socket marked healthy but carry no data. Queue depth
 * rides its own event type — it must not wait for a coincidental `run_changed`
 * while stream-healthy polling is off.
 */
export function activityLiveInvalidateKeys(event: ActivityLiveEvent): readonly string[] {
  switch (event.type) {
    case 'run_changed':
      return ['runs', 'dashboard', 'tasks']
    case 'queue_changed':
      // No run row yet — only the dashboard subtitle and automations badges.
      return ['dashboard', 'tasks']
    case 'approval_pending':
    case 'approval_settled':
      // The prompt itself lives in the run's conversation; list pages only need
      // the "waiting on you" affordance to appear and clear.
      return ['conversation', 'runs', 'dashboard']
    case 'hello':
    case 'ping':
      return []
  }
}
