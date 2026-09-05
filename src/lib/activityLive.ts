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
  /** An automation fired, missed, failed, or changed schedule health. */
  | { type: 'task_changed'; taskId: string }
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
 * A run detail already has a run-scoped stream. Opening the app-wide stream
 * there as well wastes a permanent HTTP/1 connection; two detail tabs plus
 * Vite HMR would consume Chrome's whole per-origin connection pool and leave
 * mutations or reloads waiting for a socket.
 */
export function needsActivityLiveStream(pathname: string): boolean {
  const match = /^\/runs\/([^/]+)\/?$/.exec(pathname)
  return match?.[1] === undefined || match[1] === 'new'
}

/** Coalesce bursts without postponing refreshes indefinitely under sustained activity. */
export function createActivityBatch(invalidate: (key: readonly string[]) => void) {
  const pending = new Map<string, readonly string[]>()
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    bump(keys: readonly (readonly string[])[]) {
      for (const key of keys) pending.set(JSON.stringify(key), key)
      if (timer !== null || pending.size === 0) return
      timer = setTimeout(() => {
        timer = null
        const batch = [...pending.values()]
        pending.clear()
        for (const key of batch) invalidate(key)
      }, 100)
    },
    close() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending.clear()
    },
  }
}

/** Queue depth has its own event; approval frames target one conversation. */
export const ACTIVITY_LIVE_RESUME_KEYS = [['runs'], ['dashboard'], ['tasks']] as const

/** React Query keys list pages should invalidate for an activity frame. */
export function activityLiveInvalidateKeys(
  event: ActivityLiveEvent,
): readonly (readonly string[])[] {
  switch (event.type) {
    case 'run_changed':
      return [['runs'], ['dashboard'], ['tasks']]
    case 'queue_changed':
      // No run row yet — only the dashboard subtitle and automations badges.
      return [['dashboard'], ['tasks']]
    case 'task_changed':
      return [['task', event.taskId], ['dashboard'], ['tasks']]
    case 'approval_pending':
    case 'approval_settled':
      return [['conversation', event.runId], ['runs'], ['dashboard']]
    case 'hello':
    case 'ping':
      return []
  }
}
