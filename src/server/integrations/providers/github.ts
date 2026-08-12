import { providerMeta } from '../../../lib/integrations/catalog.ts'
import { emptyActor, emptyIssue } from '../../../lib/integrations/types.ts'
import type { CanonicalWebhookEvent } from '../../../lib/integrations/types.ts'
import { verifySha256PrefixedSignature } from '../crypto.ts'
import type { IntegrationProvider, WebhookParseInput, WebhookVerifyInput } from '../types.ts'

type GhUser = { login?: string; name?: string; email?: string }
type GhLabel = { name?: string }
type GhIssue = {
  id?: number | string
  number?: number
  title?: string
  body?: string | null
  html_url?: string
  state?: string
  labels?: Array<string | GhLabel>
  assignees?: GhUser[]
  user?: GhUser
  milestone?: { title?: string } | null
}
type GhPayload = {
  action?: string
  issue?: GhIssue
  repository?: { full_name?: string; name?: string; html_url?: string }
  sender?: GhUser
  label?: GhLabel
  assignee?: GhUser
}

function labelsOf(issue: GhIssue | undefined): string[] {
  if (!issue?.labels) return []
  return issue.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean)
}

function parseGithub(input: WebhookParseInput): CanonicalWebhookEvent[] {
  const deliveryId =
    input.headers.get('x-github-delivery')?.trim() || `github_${Date.now().toString(36)}`
  const eventName = input.headers.get('x-github-event')?.trim() || ''

  if (eventName === 'ping') return []

  if (eventName !== 'issues') return []

  const payload = input.payload as GhPayload
  const action = payload.action?.trim()
  if (!action || !payload.issue) return []

  const issue = payload.issue
  const eventType = `issues.${action}`
  const assignees = (issue.assignees ?? []).map((a) => a.login || a.name || '').filter(Boolean)
  const actorUser = payload.sender ?? issue.user

  const event: CanonicalWebhookEvent = {
    provider: 'github',
    eventType,
    deliveryId: `${deliveryId}:${action}`,
    occurredAt: Date.now(),
    issue: emptyIssue({
      id: String(issue.id ?? issue.number ?? ''),
      key: issue.number != null ? `#${issue.number}` : '',
      title: issue.title ?? '',
      body: issue.body ?? '',
      url: issue.html_url ?? '',
      status: issue.state ?? '',
      labels: labelsOf(issue),
      assignees,
      project: payload.repository?.full_name ?? '',
      priority: '',
    }),
    actor: emptyActor({
      name: actorUser?.login || actorUser?.name || '',
      email: actorUser?.email || '',
    }),
    extra: {
      repository: payload.repository?.full_name ?? '',
      label: payload.label?.name ?? '',
      assignee: payload.assignee?.login ?? '',
      milestone: issue.milestone?.title ?? '',
    },
  }

  return [event]
}

export const githubProvider: IntegrationProvider = {
  ...providerMeta('github')!,
  id: 'github',
  verify(input: WebhookVerifyInput): boolean {
    return verifySha256PrefixedSignature(
      input.secret,
      input.rawBody,
      input.headers.get('x-hub-signature-256'),
    )
  },
  parse: parseGithub,
}
