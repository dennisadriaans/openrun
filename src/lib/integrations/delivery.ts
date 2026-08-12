/**
 * Shape webhook delivery rows for the Integrations UI.
 *
 * The dispatcher records `status: 'ok'` with an empty `runIds` array when a
 * verified event matched zero automations. Callers must not treat bare `ok`
 * as "a run started" — use `describeWebhookDelivery` instead.
 */
export function parseDeliveryRunIds(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

export type WebhookDeliverySummaryInput = {
  status: string
  runIds: string[] | string | null | undefined
  error?: string | null
}

export type WebhookDeliverySummary = {
  /** Short line under the event type (e.g. "matched nothing", "2 runs"). */
  detail: string
  /** Parsed run ids when the delivery started one or more runs. */
  runIds: string[]
  /** True when ok + no runs + no error — filters/bindings likely missed. */
  matchedNothing: boolean
}

/**
 * Human-readable outcome for a stored webhook delivery row.
 *
 * Prefer an explicit error/detail column (including `queued: …`) over
 * inventing copy. Only invent "matched nothing" when status is ok, there
 * are no run ids, and the error column is empty.
 */
export function describeWebhookDelivery(
  input: WebhookDeliverySummaryInput,
): WebhookDeliverySummary {
  const runIds = Array.isArray(input.runIds)
    ? input.runIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
    : parseDeliveryRunIds(input.runIds)
  const error = (input.error ?? '').trim()
  const status = (input.status ?? '').trim().toLowerCase()

  if (error) {
    return { detail: error, runIds, matchedNothing: false }
  }

  if (status === 'ignored') {
    return { detail: 'ignored — no events', runIds, matchedNothing: false }
  }

  if (status === 'duplicate') {
    return { detail: 'duplicate delivery', runIds, matchedNothing: false }
  }

  if (status === 'error') {
    return { detail: 'error', runIds, matchedNothing: false }
  }

  if (runIds.length > 0) {
    const n = runIds.length
    return {
      detail: n === 1 ? '1 run' : `${n} runs`,
      runIds,
      matchedNothing: false,
    }
  }

  if (status === 'ok') {
    return { detail: 'matched nothing', runIds, matchedNothing: true }
  }

  return { detail: status || 'unknown', runIds, matchedNothing: false }
}
