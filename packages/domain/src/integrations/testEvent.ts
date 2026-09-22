/**
 * What "Send test event" should actually send.
 *
 * A fixed `issue created` event told you almost nothing: the moment an
 * automation watched a comment, a label or a status change — which every
 * recipe but "triage new" does — the button answered "0 automations matched"
 * and looked exactly like a broken connection. The test is only worth running
 * if it exercises the binding the user made, so the event is shaped from that
 * binding: its first event id, and an issue that satisfies its filters.
 *
 * Filters are satisfied rather than ignored on purpose. A test delivery that
 * misses on `labels: ["agent"]` proves nothing about the delivery path, and the
 * user cannot tell which of the two it failed on.
 *
 * Pure and browser-safe: the server shapes the event with it, and the UI names
 * the event it sent with the same value.
 */
import type { IntegrationProviderId, WebhookFilters } from './types.ts'

/** Fallback when nothing is bound yet: the event every provider always emits. */
const CREATED_EVENT: Record<IntegrationProviderId, string> = {
  github: 'issues.opened',
  gitlab: 'issue.open',
  bitbucket: 'issue:created',
  jira: 'jira:issue_created',
  linear: 'Issue.create',
  'azure-devops': 'workitem.created',
}

export type TestEventBinding = {
  /** Catalog event ids the automation binds. Empty means "every event". */
  events: string[]
  filters: WebhookFilters
}

export type TestEventShape = {
  eventType: string
  labels: string[]
  status: string
  previousStatus: string
  assignees: string[]
  project: string
}

const DEFAULT_STATUS = 'To Do'
const DEFAULT_ASSIGNEE = 'Ada'
const DEFAULT_PROJECT = 'TEST'

/**
 * Shape a delivery from the first binding on this connection, falling back to
 * a plain "created" event when nothing binds it yet. Later bindings are
 * ignored: one event cannot satisfy two contradictory filters, and the first
 * one is the automation the setup panel just created.
 */
export function testEventShape(
  provider: IntegrationProviderId,
  bindings: readonly TestEventBinding[],
): TestEventShape {
  const created = CREATED_EVENT[provider]
  const binding = bindings.find((b) => b.events.length > 0 || hasFilter(b.filters))

  if (!binding) {
    return {
      eventType: created,
      labels: [],
      status: DEFAULT_STATUS,
      previousStatus: '',
      assignees: [DEFAULT_ASSIGNEE],
      project: DEFAULT_PROJECT,
    }
  }

  const filters = binding.filters
  return {
    // An automation bound to "every event" still has to receive something.
    eventType: binding.events[0] ?? created,
    labels: filters.labels?.length ? [filters.labels[0] as string] : [],
    status: filters.statuses?.length ? (filters.statuses[0] as string) : DEFAULT_STATUS,
    previousStatus: filters.previousStatuses?.length ? (filters.previousStatuses[0] as string) : '',
    assignees: filters.assignees?.length ? [filters.assignees[0] as string] : [DEFAULT_ASSIGNEE],
    project: filters.projects?.length ? (filters.projects[0] as string) : DEFAULT_PROJECT,
  }
}

function hasFilter(filters: WebhookFilters): boolean {
  return Boolean(
    filters.labels?.length ||
      filters.projects?.length ||
      filters.statuses?.length ||
      filters.previousStatuses?.length ||
      filters.assignees?.length,
  )
}
