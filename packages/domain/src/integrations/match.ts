/**
 * Match a canonical event against automation webhook bindings.
 */
import type { CanonicalWebhookEvent, WebhookFilters } from './types.ts'

function norm(s: string): string {
  return s.trim().toLowerCase()
}

function includesAny(haystack: string[], needles: string[]): boolean {
  if (needles.length === 0) return true
  const set = new Set(haystack.map(norm).filter(Boolean))
  return needles.some((n) => set.has(norm(n)))
}

function equalsAny(value: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  const v = norm(value)
  if (!v) return false
  return allowed.some((a) => norm(a) === v)
}

export function parseWebhookEvents(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

export function parseWebhookFilters(raw: string | null | undefined): WebhookFilters {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as WebhookFilters
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      labels: Array.isArray(parsed.labels) ? parsed.labels.map(String) : undefined,
      projects: Array.isArray(parsed.projects) ? parsed.projects.map(String) : undefined,
      statuses: Array.isArray(parsed.statuses) ? parsed.statuses.map(String) : undefined,
      previousStatuses: Array.isArray(parsed.previousStatuses)
        ? parsed.previousStatuses.map(String)
        : undefined,
      assignees: Array.isArray(parsed.assignees) ? parsed.assignees.map(String) : undefined,
    }
  } catch {
    return {}
  }
}

export function eventTypeMatches(eventType: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  return allowed.includes(eventType)
}

export function eventMatchesFilters(
  event: CanonicalWebhookEvent,
  filters: WebhookFilters,
): boolean {
  if (filters.labels?.length && !includesAny(event.issue.labels, filters.labels)) {
    return false
  }
  if (filters.projects?.length) {
    const projectHay = [event.issue.project, event.issue.key.split('-')[0] ?? ''].filter(Boolean)
    if (!includesAny(projectHay, filters.projects)) return false
  }
  if (filters.statuses?.length && !equalsAny(event.issue.status, filters.statuses)) {
    return false
  }
  if (
    filters.previousStatuses?.length &&
    !equalsAny(event.issue.previousStatus, filters.previousStatuses)
  ) {
    return false
  }
  if (filters.assignees?.length && !includesAny(event.issue.assignees, filters.assignees)) {
    return false
  }
  return true
}

export function taskMatchesWebhookEvent(
  task: {
    webhookIntegrationId: string
    webhookEvents: string
    webhookFilters: string
  },
  integrationId: string,
  event: CanonicalWebhookEvent,
): boolean {
  if (!task.webhookIntegrationId || task.webhookIntegrationId !== integrationId) return false
  const events = parseWebhookEvents(task.webhookEvents)
  if (!eventTypeMatches(event.eventType, events)) return false
  return eventMatchesFilters(event, parseWebhookFilters(task.webhookFilters))
}
