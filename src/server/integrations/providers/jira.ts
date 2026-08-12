import { providerMeta } from '../../../lib/integrations/catalog.ts'
import { emptyActor, emptyIssue } from '../../../lib/integrations/types.ts'
import type { CanonicalWebhookEvent } from '../../../lib/integrations/types.ts'
import { verifySha256PrefixedSignature } from '../crypto.ts'
import type { IntegrationProvider, WebhookParseInput, WebhookVerifyInput } from '../types.ts'

type JiraUser = {
  displayName?: string
  emailAddress?: string
  name?: string
  accountId?: string
}
type JiraStatus = { name?: string; id?: string }
type JiraFields = {
  summary?: string
  description?: unknown
  status?: JiraStatus
  assignee?: JiraUser | null
  labels?: string[]
  priority?: { name?: string } | null
  project?: { key?: string; name?: string }
}
type JiraIssue = {
  id?: string
  key?: string
  self?: string
  fields?: JiraFields
}
type JiraChangelogItem = {
  field?: string
  fieldtype?: string
  fromString?: string | null
  toString?: string | null
  from?: string | null
  to?: string | null
}
type JiraPayload = {
  webhookEvent?: string
  issue_event_type_name?: string
  timestamp?: number
  issue?: JiraIssue
  user?: JiraUser
  changelog?: { items?: JiraChangelogItem[] }
  comment?: { body?: string; author?: JiraUser }
}

function descriptionText(desc: unknown): string {
  if (desc == null) return ''
  if (typeof desc === 'string') return desc
  // ADF (Atlassian Document Format) — keep a compact JSON dump rather than drop it.
  try {
    return JSON.stringify(desc)
  } catch {
    return String(desc)
  }
}

function browseUrl(issue: JiraIssue | undefined): string {
  if (!issue?.key) return issue?.self ?? ''
  const self = issue.self ?? ''
  // self looks like https://host.atlassian.net/rest/api/2/issue/10000
  const m = self.match(/^(https?:\/\/[^/]+)/)
  if (m) return `${m[1]}/browse/${issue.key}`
  return issue.self ?? ''
}

function changelogHas(
  field: string,
  items: JiraChangelogItem[] | undefined,
): JiraChangelogItem | undefined {
  return items?.find((i) => (i.field ?? '').toLowerCase() === field.toLowerCase())
}

function parseJira(input: WebhookParseInput): CanonicalWebhookEvent[] {
  const payload = input.payload as JiraPayload
  const webhookEvent = payload.webhookEvent?.trim() || ''
  if (!webhookEvent) return []

  const deliveryHeader =
    input.headers.get('x-atlassian-webhook-identifier')?.trim() ||
    input.headers.get('x-atlassian-webhook-retry')?.trim() ||
    ''
  const deliveryId = deliveryHeader || `jira_${payload.timestamp ?? Date.now()}_${webhookEvent}`

  const issue = payload.issue
  const fields = issue?.fields
  const items = payload.changelog?.items
  const statusChange = changelogHas('status', items)
  const assigneeChange = changelogHas('assignee', items)

  const base: CanonicalWebhookEvent = {
    provider: 'jira',
    eventType: webhookEvent,
    deliveryId: `${deliveryId}:${webhookEvent}`,
    occurredAt: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    issue: emptyIssue({
      id: issue?.id ?? '',
      key: issue?.key ?? '',
      title: fields?.summary ?? '',
      body:
        webhookEvent.startsWith('comment_') && payload.comment?.body
          ? payload.comment.body
          : descriptionText(fields?.description),
      url: browseUrl(issue),
      status: fields?.status?.name ?? statusChange?.toString ?? '',
      previousStatus: statusChange?.fromString ?? '',
      labels: fields?.labels ?? [],
      assignees: fields?.assignee?.displayName
        ? [fields.assignee.displayName]
        : fields?.assignee?.name
          ? [fields.assignee.name]
          : [],
      project: fields?.project?.key || fields?.project?.name || '',
      priority: fields?.priority?.name ?? '',
    }),
    actor: emptyActor({
      name: payload.user?.displayName || payload.user?.name || '',
      email: payload.user?.emailAddress || '',
    }),
    extra: {
      issueEventType: payload.issue_event_type_name ?? '',
      fromStatus: statusChange?.fromString ?? '',
      toStatus: statusChange?.toString ?? '',
    },
  }

  const events: CanonicalWebhookEvent[] = [base]

  // Derived first-class events so automations can filter "status changed" without
  // matching every jira:issue_updated.
  if (webhookEvent === 'jira:issue_updated' && statusChange) {
    events.push({
      ...base,
      eventType: 'jira:issue_status_changed',
      deliveryId: `${deliveryId}:jira:issue_status_changed`,
      issue: {
        ...base.issue,
        status: statusChange.toString ?? base.issue.status,
        previousStatus: statusChange.fromString ?? '',
      },
    })
  }
  if (webhookEvent === 'jira:issue_updated' && assigneeChange) {
    events.push({
      ...base,
      eventType: 'jira:issue_assigned',
      deliveryId: `${deliveryId}:jira:issue_assigned`,
    })
  }

  return events
}

export const jiraProvider: IntegrationProvider = {
  ...providerMeta('jira')!,
  id: 'jira',
  verify(input: WebhookVerifyInput): boolean {
    return verifySha256PrefixedSignature(
      input.secret,
      input.rawBody,
      input.headers.get('x-hub-signature'),
    )
  },
  parse: parseJira,
}
