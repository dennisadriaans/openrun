/**
 * Register a Jira Cloud admin webhook with a one-shot email + API token (not stored).
 */
export type JiraWebhookCreateResult = {
  remoteWebhookId: string
}

function normalizeSiteUrl(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new Error('Enter your Jira site URL, e.g. https://your-site.atlassian.net')
  let parsed: URL
  try {
    parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    throw new Error('Jira site URL looks invalid')
  }
  return parsed.origin
}

function basicAuth(email: string, apiToken: string): string {
  return Buffer.from(`${email.trim()}:${apiToken.trim()}`, 'utf8').toString('base64')
}

export async function createJiraWebhook(input: {
  siteUrl: string
  email: string
  apiToken: string
  webhookUrl: string
  secret: string
  name: string
  events: string[]
  jql?: string
}): Promise<JiraWebhookCreateResult> {
  const origin = normalizeSiteUrl(input.siteUrl)
  const email = input.email.trim()
  const token = input.apiToken.trim()
  if (!email) throw new Error('Enter the Atlassian account email for the API token.')
  if (!token) {
    throw new Error(
      'Paste an Atlassian API token (https://id.atlassian.com/manage-profile/security/api-tokens).',
    )
  }

  const body: Record<string, unknown> = {
    name: input.name.slice(0, 100) || 'Open Run',
    url: input.webhookUrl,
    events: input.events.length ? input.events : ['jira:issue_created', 'jira:issue_updated'],
    excludeBody: false,
    secret: input.secret,
  }
  const jql = input.jql?.trim()
  if (jql) body.filters = { 'issue-related-events-section': jql }

  const res = await fetch(`${origin}/rest/webhooks/1.0/webhook`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basicAuth(email, token)}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 400)
    try {
      const errJson = JSON.parse(text) as { message?: string; errorMessages?: string[] }
      detail =
        errJson.message ||
        errJson.errorMessages?.join('; ') ||
        detail
    } catch {
      // keep raw
    }
    throw new Error(detail || `Jira HTTP ${res.status}`)
  }

  let parsed: { self?: string; id?: number | string }
  try {
    parsed = JSON.parse(text || '{}') as { self?: string; id?: number | string }
  } catch {
    throw new Error('Jira returned an unexpected webhook response')
  }
  const fromSelf = parsed.self?.match(/\/webhook\/(\d+)/)?.[1]
  const id = parsed.id != null ? String(parsed.id) : fromSelf
  if (!id) throw new Error('Jira webhook create did not return an id')
  return { remoteWebhookId: id }
}

export async function deleteJiraWebhook(input: {
  siteUrl: string
  email: string
  apiToken: string
  remoteWebhookId: string
}): Promise<void> {
  const origin = normalizeSiteUrl(input.siteUrl)
  const res = await fetch(`${origin}/rest/webhooks/1.0/webhook/${input.remoteWebhookId}`, {
    method: 'DELETE',
    headers: {
      authorization: `Basic ${basicAuth(input.email, input.apiToken)}`,
      accept: 'application/json',
    },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Jira webhook delete failed (HTTP ${res.status})`)
  }
}

export { normalizeSiteUrl as normalizeJiraSiteUrl }
