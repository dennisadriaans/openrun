/**
 * Render an automation prompt against a canonical webhook event.
 *
 * Templates may use {{dot.path}} placeholders. When the saved prompt has no
 * placeholders, a structured context block is appended so the agent still sees
 * the issue natively.
 *
 * The ticket URL is the one field that never reaches the agent. A bare link in
 * the prompt reads as "go open this", so agents stall on fetching it instead of
 * using the body two lines below. `webhookSourceLink` hands it to the UI
 * instead, where it renders as a badge on the message a human can click.
 */
import type { CanonicalWebhookEvent, IntegrationProviderId } from './types.ts'

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g

export type WebhookSourceLink = {
  provider: IntegrationProviderId
  url: string
  /** What the badge says next to the mark — the issue key when there is one. */
  label: string
}

/** The clickable origin of this event, or null when the provider sent no URL. */
export function webhookSourceLink(event: CanonicalWebhookEvent): WebhookSourceLink | null {
  if (!event.issue.url) return null
  return {
    provider: event.provider,
    url: event.issue.url,
    label: event.issue.key || event.issue.title,
  }
}

/**
 * Drop the ticket URL from a rendered prompt. A line that held nothing but the
 * link goes with it, so the template's blank-line rhythm survives.
 */
function stripSourceUrl(text: string, url: string): string {
  if (!url || !text.includes(url)) return text
  const kept: string[] = []
  for (const line of text.split('\n')) {
    if (!line.includes(url)) {
      kept.push(line)
      continue
    }
    const without = line.replaceAll(url, '').replace(/[ \t]{2,}/g, ' ')
    if (without.trim() === '') continue
    kept.push(without.trimEnd())
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

function lookup(event: CanonicalWebhookEvent, path: string): string {
  const parts = path.split('.')
  let cur: unknown = {
    event: {
      type: event.eventType,
      provider: event.provider,
      deliveryId: event.deliveryId,
    },
    issue: {
      id: event.issue.id,
      key: event.issue.key,
      title: event.issue.title,
      body: event.issue.body,
      url: event.issue.url,
      status: event.issue.status,
      previousStatus: event.issue.previousStatus,
      labels: event.issue.labels.join(', '),
      assignees: event.issue.assignees.join(', '),
      project: event.issue.project,
      priority: event.issue.priority,
    },
    actor: {
      name: event.actor.name,
      email: event.actor.email,
    },
    extra: event.extra,
  }
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return ''
    cur = (cur as Record<string, unknown>)[part]
  }
  if (cur == null) return ''
  if (Array.isArray(cur)) return cur.map(String).join(', ')
  return String(cur)
}

export function promptHasPlaceholders(prompt: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0
  return PLACEHOLDER_RE.test(prompt)
}

export function renderWebhookPrompt(prompt: string, event: CanonicalWebhookEvent): string {
  const rendered = prompt.replace(PLACEHOLDER_RE, (_m, path: string) => lookup(event, path))
  const base = stripSourceUrl(rendered, event.issue.url).trimEnd()
  if (promptHasPlaceholders(prompt)) return base

  const lines = [
    base,
    '',
    '---',
    'Incoming webhook context',
    `Provider: ${event.provider}`,
    `Event: ${event.eventType}`,
    event.issue.key ? `Issue: ${event.issue.key}` : null,
    event.issue.title ? `Title: ${event.issue.title}` : null,
    event.issue.status ? `Status: ${event.issue.status}` : null,
    event.issue.previousStatus ? `Previous status: ${event.issue.previousStatus}` : null,
    event.issue.labels.length ? `Labels: ${event.issue.labels.join(', ')}` : null,
    event.issue.assignees.length ? `Assignees: ${event.issue.assignees.join(', ')}` : null,
    event.issue.project ? `Project: ${event.issue.project}` : null,
    event.actor.name ? `Actor: ${event.actor.name}` : null,
    event.issue.body ? `Body:\n${event.issue.body}` : null,
  ].filter((l): l is string => l != null)

  return lines.join('\n').trimEnd()
}
