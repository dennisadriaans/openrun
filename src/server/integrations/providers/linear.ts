import { providerMeta } from '../../../lib/integrations/catalog.ts'
import { emptyActor, emptyIssue } from '../../../lib/integrations/types.ts'
import type { CanonicalWebhookEvent } from '../../../lib/integrations/types.ts'
import { verifyHexHmacSignature } from '../crypto.ts'
import type { IntegrationProvider, WebhookParseInput, WebhookVerifyInput } from '../types.ts'

type LinearActor = { id?: string; name?: string; email?: string; type?: string }
type LinearIssueData = {
  id?: string
  identifier?: string
  title?: string
  description?: string | null
  url?: string
  stateId?: string
  state?: { id?: string; name?: string; type?: string }
  assigneeId?: string | null
  assignee?: { id?: string; name?: string; email?: string } | null
  teamId?: string
  team?: { id?: string; key?: string; name?: string }
  projectId?: string | null
  project?: { id?: string; name?: string } | null
  priority?: number
  priorityLabel?: string
  labelIds?: string[]
  labels?: Array<{ id?: string; name?: string }>
  updatedAt?: string
  createdAt?: string
}
type LinearPayload = {
  action?: string
  type?: string
  createdAt?: string
  organizationId?: string
  webhookTimestamp?: number
  webhookId?: string
  actor?: LinearActor
  data?: LinearIssueData & Record<string, unknown>
  updatedFrom?: Partial<LinearIssueData> & Record<string, unknown>
}

const LINEAR_TS_SKEW_MS = 60_000

function priorityLabel(data: LinearIssueData | undefined): string {
  if (!data) return ''
  if (data.priorityLabel) return data.priorityLabel
  if (typeof data.priority === 'number') return String(data.priority)
  return ''
}

function parseLinear(input: WebhookParseInput): CanonicalWebhookEvent[] {
  const payload = input.payload as LinearPayload
  const resource = payload.type?.trim() || ''
  const action = payload.action?.trim() || ''
  if (!resource || !action) return []

  const eventType = `${resource}.${action}`
  const deliveryId =
    input.headers.get('linear-delivery')?.trim() ||
    payload.webhookId ||
    `linear_${payload.webhookTimestamp ?? Date.now()}_${eventType}`

  const data = payload.data
  const updatedFrom = payload.updatedFrom
  const labels =
    data?.labels?.map((l) => l.name ?? '').filter(Boolean) ??
    []

  const prevState =
    typeof updatedFrom?.stateId === 'string'
      ? String(updatedFrom.stateId)
      : typeof updatedFrom?.state === 'object' && updatedFrom.state && 'name' in updatedFrom.state
        ? String((updatedFrom.state as { name?: string }).name ?? '')
        : ''

  const statusName = data?.state?.name || data?.stateId || ''
  const previousStatus =
    prevState && prevState !== (data?.stateId ?? '')
      ? prevState
      : ''

  const base: CanonicalWebhookEvent = {
    provider: 'linear',
    eventType,
    deliveryId: `${deliveryId}:${eventType}`,
    occurredAt:
      typeof payload.webhookTimestamp === 'number'
        ? payload.webhookTimestamp
        : payload.createdAt
          ? Date.parse(payload.createdAt)
          : Date.now(),
    issue: emptyIssue({
      id: data?.id ?? '',
      key: data?.identifier ?? '',
      title: data?.title ?? '',
      body: data?.description ?? '',
      url: data?.url ?? '',
      status: statusName,
      previousStatus,
      labels,
      assignees: data?.assignee?.name
        ? [data.assignee.name]
        : data?.assigneeId
          ? [data.assigneeId]
          : [],
      project: data?.project?.name || data?.team?.key || data?.team?.name || '',
      priority: priorityLabel(data),
    }),
    actor: emptyActor({
      name: payload.actor?.name || '',
      email: payload.actor?.email || '',
    }),
    extra: {
      organizationId: payload.organizationId ?? '',
      teamId: data?.teamId ?? '',
      stateId: data?.stateId ?? '',
      previousStateId:
        typeof updatedFrom?.stateId === 'string' ? updatedFrom.stateId : '',
    },
  }

  const events: CanonicalWebhookEvent[] = [base]

  if (
    resource === 'Issue' &&
    action === 'update' &&
    updatedFrom &&
    Object.prototype.hasOwnProperty.call(updatedFrom, 'stateId')
  ) {
    events.push({
      ...base,
      eventType: 'Issue.status_changed',
      deliveryId: `${deliveryId}:Issue.status_changed`,
      issue: {
        ...base.issue,
        previousStatus:
          typeof updatedFrom.stateId === 'string' ? updatedFrom.stateId : base.issue.previousStatus,
      },
    })
  }

  if (
    resource === 'Issue' &&
    action === 'update' &&
    updatedFrom &&
    Object.prototype.hasOwnProperty.call(updatedFrom, 'assigneeId')
  ) {
    events.push({
      ...base,
      eventType: 'Issue.assigned',
      deliveryId: `${deliveryId}:Issue.assigned`,
    })
  }

  return events
}

export const linearProvider: IntegrationProvider = {
  ...providerMeta('linear')!,
  id: 'linear',
  verify(input: WebhookVerifyInput): boolean {
    if (
      !verifyHexHmacSignature(
        input.secret,
        input.rawBody,
        input.headers.get('linear-signature'),
      )
    ) {
      return false
    }
    const payload = input.payload as LinearPayload | undefined
    if (payload && typeof payload.webhookTimestamp === 'number') {
      if (Math.abs(Date.now() - payload.webhookTimestamp) > LINEAR_TS_SKEW_MS) {
        return false
      }
    }
    return true
  },
  parse: parseLinear,
}
