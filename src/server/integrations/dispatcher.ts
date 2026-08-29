/**
 * Webhook delivery pipeline: relayed event → match automations → startRun.
 *
 * Verification and normalization happen on the control plane, so what arrives
 * here is already a `CanonicalWebhookEvent`.
 */
import { hasWorkspaceId } from '../../lib/workspaceRef.ts'
import { assertWorkspaceReady } from '../../lib/workspaceReady.ts'
import {
  parseWebhookEvents,
  parseWebhookFilters,
  taskMatchesWebhookEvent,
} from '../../lib/integrations/match.ts'
import { renderWebhookPrompt, webhookSourceLink } from '../../lib/integrations/prompt.ts'
import type { CanonicalWebhookEvent } from '../../lib/integrations/types.ts'
import { getDb, type RuntimeRow, type TaskRow } from '../db.ts'
import { startRun } from '../executor.ts'
import { enqueueRun, workspaceBusy, WORKSPACE_BUSY_MESSAGE } from '../runQueue.ts'
import { unattendedRefusal } from '../unattendedPreflight.ts'
import { getIntegration } from './connections.ts'
import { getWorkspace } from '../workspaces.ts'

export type WebhookHandleResult = {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

type DeliveryRow = {
  id: string
  integrationId: string
  deliveryKey: string
  eventType: string
  status: string
  runIds: string
  error: string
  receivedAt: number
}

function deliveryId(): string {
  return `whd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function recordDelivery(input: {
  integrationId: string
  deliveryKey: string
  eventType: string
  status: 'ok' | 'ignored' | 'duplicate' | 'error'
  runIds: string[]
  error?: string
  /** Automations whose run was parked because the workspace was busy. */
  queuedTaskIds?: string[]
}) {
  const db = getDb()
  db.prepare(
    `INSERT INTO webhook_deliveries (id, integrationId, deliveryKey, eventType, status, runIds, error, receivedAt)
     VALUES (@id, @integrationId, @deliveryKey, @eventType, @status, @runIds, @error, @receivedAt)`,
  ).run({
    id: deliveryId(),
    integrationId: input.integrationId,
    deliveryKey: input.deliveryKey,
    eventType: input.eventType,
    status: input.status,
    runIds: JSON.stringify(input.runIds),
    // Queued fires have no run id yet; note them in the error/detail column so
    // the Integrations page shows the delivery did something.
    error:
      input.queuedTaskIds && input.queuedTaskIds.length > 0
        ? [input.error, `queued: ${input.queuedTaskIds.join(', ')}`].filter(Boolean).join('; ')
        : (input.error ?? ''),
    receivedAt: Date.now(),
  })
}

function alreadyProcessed(integrationId: string, deliveryKey: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM webhook_deliveries
       WHERE integrationId = ? AND deliveryKey = ? AND status IN ('ok', 'ignored', 'duplicate')
       LIMIT 1`,
    )
    .get(integrationId, deliveryKey) as { id: string } | undefined
  return Boolean(row)
}

function matchingTasks(integrationId: string, event: CanonicalWebhookEvent): TaskRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE enabled = 1
         AND webhookIntegrationId = ?
         AND workspaceId != ''`,
    )
    .all(integrationId) as TaskRow[]
  return rows.filter((t) => taskMatchesWebhookEvent(t, integrationId, event))
}

/**
 * Reason this automation must not fire at all right now — a shared checkout, a
 * contaminated worktree, or a GitHub capability that is not usable. Distinct
 * from a busy workspace: none of these get better by waiting, so the caller
 * records the refusal instead of parking the fire in the queue.
 */
function webhookRefusal(task: TaskRow): string | null {
  const runtime = getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(task.runtimeId) as
    | RuntimeRow
    | undefined
  if (!runtime) return `Runtime not found: ${task.runtimeId}`
  if (!hasWorkspaceId(task.workspaceId)) return `Task ${task.id} has no workspace`
  // A live run is expected to make the worktree dirty or switch branches.
  // Queue that explicit busy condition before health inspection; all other
  // failures are permanent delivery failures and must not be hidden in the
  // queue.
  if (workspaceBusy(task.workspaceId)) return null
  return unattendedRefusal(task, runtime)
}

function fireTask(task: TaskRow, event: CanonicalWebhookEvent): string {
  const runtime = getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(task.runtimeId) as
    | RuntimeRow
    | undefined
  if (!runtime) throw new Error(`Runtime not found: ${task.runtimeId}`)
  if (!hasWorkspaceId(task.workspaceId)) {
    throw new Error(`Task ${task.id} has no workspace`)
  }
  const workspace = getWorkspace(task.workspaceId)
  assertWorkspaceReady(workspace?.status)
  const prompt = renderWebhookPrompt(task.prompt, event)
  const source = webhookSourceLink(event)
  return startRun({
    runtime,
    taskId: task.id,
    taskName: task.name,
    prompt,
    cwd: task.cwd,
    workspaceId: task.workspaceId,
    trigger: 'webhook',
    model: task.model,
    effort: task.effort,
    timeoutMs: task.timeoutMs,
    resumeSessionId: task.resumeSessionId,
    resumeSessionLabel: task.resumeSessionLabel,
    ...(source ? { source } : {}),
  })
}

/** Match automations and start runs for a relayed, already-canonical event. */
export async function ingestCanonicalEvent(
  integrationId: string,
  event: CanonicalWebhookEvent,
): Promise<WebhookHandleResult> {
  return ingestCanonicalEvents(integrationId, [event])
}

function ingestCanonicalEvents(
  integrationId: string,
  events: CanonicalWebhookEvent[],
): WebhookHandleResult {
  const integration = getIntegration(integrationId)
  if (!integration?.enabled) {
    return { ok: false, status: 404, body: { error: 'Integration not found' } }
  }

  const started: Array<{ eventType: string; runId: string; taskId: string }> = []
  const errors: string[] = []

  for (const event of events) {
    if (alreadyProcessed(integration.id, event.deliveryId)) {
      recordDelivery({
        integrationId: integration.id,
        deliveryKey: event.deliveryId,
        eventType: event.eventType,
        status: 'duplicate',
        runIds: [],
      })
      continue
    }

    const tasks = matchingTasks(integration.id, event)
    const source = webhookSourceLink(event)
    const runIds: string[] = []
    const queuedTaskIds: string[] = []
    for (const task of tasks) {
      // Checked before the try: a refusal here is permanent for this delivery,
      // and queueing it would only replay the same failure later.
      const refused = webhookRefusal(task)
      if (refused) {
        errors.push(`${task.id}: ${refused}`)
        continue
      }
      try {
        const runId = fireTask(task, event)
        runIds.push(runId)
        started.push({ eventType: event.eventType, runId, taskId: task.id })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message !== WORKSPACE_BUSY_MESSAGE) {
          errors.push(`${task.id}: ${message}`)
          console.error(`[webhook] failed to start task ${task.id}:`, err)
          continue
        }
        const queued = enqueueRun({
          taskId: task.id,
          workspaceId: task.workspaceId,
          trigger: 'webhook',
          prompt: renderWebhookPrompt(task.prompt, event),
          ...(source ? { source } : {}),
        })
        if (queued.queued) {
          queuedTaskIds.push(task.id)
          continue
        }
        errors.push(`${task.id}: ${message} (not queued: ${queued.reason})`)
        console.error(`[webhook] failed to start task ${task.id}:`, err)
      }
    }

    recordDelivery({
      integrationId: integration.id,
      deliveryKey: event.deliveryId,
      eventType: event.eventType,
      status: errors.length && runIds.length === 0 && queuedTaskIds.length === 0 ? 'error' : 'ok',
      runIds,
      error: errors.join('; '),
      queuedTaskIds,
    })
  }

  return {
    ok: true,
    status: 202,
    body: {
      accepted: true,
      matched: started.length,
      runs: started,
      errors: errors.length ? errors : undefined,
      events: events.map((e) => e.eventType),
    },
  }
}

export function listRecentDeliveries(limit = 50): DeliveryRow[] {
  return getDb()
    .prepare(`SELECT * FROM webhook_deliveries ORDER BY receivedAt DESC LIMIT ?`)
    .all(limit) as DeliveryRow[]
}

export function listDeliveriesForIntegration(integrationId: string, limit = 30): DeliveryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM webhook_deliveries
       WHERE integrationId = ?
       ORDER BY receivedAt DESC
       LIMIT ?`,
    )
    .all(integrationId, limit) as DeliveryRow[]
}

// Re-export parsers so core can validate task input without circular imports.
export { parseWebhookEvents, parseWebhookFilters }
