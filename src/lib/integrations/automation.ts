/**
 * Browser-safe defaults for wiring a connected integration to an automation.
 *
 * Every connection is made through the control plane, so nothing here deals in
 * public URLs, signing secrets, or vendor credentials.
 */
import type { IntegrationProviderId } from './types.ts'
import { providerMeta } from './catalog.ts'

export function cloudConnectionIdFromConfig(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw || '{}') as { cloudConnectionId?: unknown }
    return typeof parsed.cloudConnectionId === 'string' && parsed.cloudConnectionId.trim()
      ? parsed.cloudConnectionId.trim()
      : null
  } catch {
    return null
  }
}

/** Sensible defaults so an automation works without picking every event. */
export const DEFAULT_INSTALL_EVENTS: Record<IntegrationProviderId, string[]> = {
  github: ['issues.opened'],
  gitlab: ['issue.open', 'issue.status_changed'],
  bitbucket: ['issue:created', 'issue:status_changed'],
  jira: ['jira:issue_created', 'jira:issue_status_changed'],
  linear: ['Issue.create', 'Issue.status_changed'],
  'azure-devops': ['workitem.created', 'workitem.status_changed'],
}

export function defaultInstallEvents(provider: IntegrationProviderId): string[] {
  return [...DEFAULT_INSTALL_EVENTS[provider]]
}

/**
 * Narrow a requested event list to ids this provider actually emits.
 *
 * An id outside the catalog can never match a delivery, so binding one produces
 * an automation that looks armed and silently never fires. The setup form and
 * the server write path both run this, so the UI cannot offer a binding the
 * server would drop.
 *
 * Empty after filtering normally falls back to the provider defaults — "I did
 * not pick" means "use the sensible set". `allowEmpty` is for the explicit
 * "every event" custom trigger, which stores `[]` and matches any delivery.
 */
export function bindAutomationEvents(
  provider: IntegrationProviderId,
  requested: string[] | undefined,
  bindableEventIds: readonly string[],
  opts?: { allowEmpty?: boolean },
): string[] {
  const known = new Set(bindableEventIds)
  const picked = (requested ?? []).map((id) => id.trim()).filter((id) => known.has(id))
  const unique = [...new Set(picked)]
  if (unique.length > 0) return unique
  if (opts?.allowEmpty) return []
  return defaultInstallEvents(provider)
}

export function defaultAutomationName(
  provider: IntegrationProviderId,
  connectionName: string,
): string {
  const label = providerMeta(provider)?.label ?? provider
  return `${label}: ${connectionName}`
}

export function defaultAutomationPrompt(provider: IntegrationProviderId): string {
  const meta = providerMeta(provider)
  const label = meta?.label ?? provider
  return [
    `You received a ${label} webhook ({{event.type}}).`,
    '',
    'Issue {{issue.key}}: {{issue.title}}',
    'URL: {{issue.url}}',
    'Status: {{issue.status}}',
    'Labels: {{issue.labels}}',
    'Assignees: {{issue.assignees}}',
    '',
    'Body:',
    '{{issue.body}}',
    '',
    'Investigate and take the appropriate coding action in this workspace.',
    'Prefer a focused change and leave the tree ready to review.',
  ].join('\n')
}
