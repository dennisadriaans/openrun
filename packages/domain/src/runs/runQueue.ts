/**
 * Pending-run queue policy.
 *
 * A workspace runs one agent at a time (`assertWorkspaceFree`). Until now a
 * cron tick that landed while the previous run was still working simply threw:
 * the scheduler logged it to the console and the fire was lost — no run row, no
 * trace in the UI, nothing to notice. Verification made that worse by keeping
 * runs busy for longer.
 *
 * Unattended triggers now wait their turn instead. Interactive ones do not: a
 * person who just pressed Run now should be told the workspace is busy, not
 * have their run start silently twenty minutes later.
 *
 * Node-free so the scheduler, the webhook dispatcher and the UI share one set
 * of rules.
 */

export type QueueTrigger = 'manual' | 'schedule' | 'planner' | 'chat' | 'webhook'

/** How many pending entries one automation may hold before we start dropping. */
export const MAX_QUEUE_PER_TASK = 5

/** Triggers with nobody watching — these wait rather than fail. */
export function isQueueableTrigger(trigger: QueueTrigger | string): boolean {
  return trigger === 'schedule' || trigger === 'webhook'
}

export type QueueDecision =
  /** Add a pending entry. */
  | { action: 'enqueue' }
  /**
   * An identical pending fire already exists — running the same cron job twice
   * back to back achieves nothing, so the existing entry stands.
   */
  | { action: 'coalesce'; reason: string }
  /** The queue for this automation is full; the fire is recorded as dropped. */
  | { action: 'drop'; reason: string }
  /** Interactive trigger — surface the busy workspace to the caller instead. */
  | { action: 'refuse' }

export type PendingEntry = {
  taskId: string
  trigger: string
}

export function queueDecision(input: {
  taskId: string
  trigger: QueueTrigger | string
  /** Entries already pending for this workspace. */
  pending: PendingEntry[]
}): QueueDecision {
  if (!isQueueableTrigger(input.trigger)) return { action: 'refuse' }

  const forTask = input.pending.filter((p) => p.taskId === input.taskId)

  // A schedule is "run this now" — a second identical pending fire is not more
  // work, it is the same work waiting twice.
  if (input.trigger === 'schedule' && forTask.some((p) => p.trigger === 'schedule')) {
    return {
      action: 'coalesce',
      reason: 'A scheduled run for this automation is already waiting on the workspace.',
    }
  }

  // Webhook fires are distinct events (different issues), so they do stack —
  // but not without bound, or one busy workspace turns into a backlog of
  // hundreds of stale agent runs.
  if (forTask.length >= MAX_QUEUE_PER_TASK) {
    return {
      action: 'drop',
      reason: `Already ${MAX_QUEUE_PER_TASK} runs waiting for this automation — dropping this trigger.`,
    }
  }

  return { action: 'enqueue' }
}

export function queuedRunMessage(position: number): string {
  return position <= 1
    ? 'Workspace busy — this run is queued and starts when the current one finishes.'
    : `Workspace busy — this run is queued at position ${position}.`
}

export function queueDepthLabel(depth: number): string {
  if (depth <= 0) return ''
  return depth === 1 ? '1 run queued' : `${depth} runs queued`
}
