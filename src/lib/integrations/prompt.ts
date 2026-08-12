/**
 * Render an automation prompt against a canonical webhook event.
 *
 * Templates may use {{dot.path}} placeholders. When the saved prompt has no
 * placeholders, a structured context block is appended so the agent still sees
 * the issue natively.
 */
import type { CanonicalWebhookEvent } from './types.ts'

const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g

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
  const base = prompt.replace(PLACEHOLDER_RE, (_m, path: string) => lookup(event, path))
  if (promptHasPlaceholders(prompt)) return base.trimEnd()

  const lines = [
    base.trimEnd(),
    '',
    '---',
    'Incoming webhook context',
    `Provider: ${event.provider}`,
    `Event: ${event.eventType}`,
    event.issue.key ? `Issue: ${event.issue.key}` : null,
    event.issue.title ? `Title: ${event.issue.title}` : null,
    event.issue.url ? `URL: ${event.issue.url}` : null,
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
