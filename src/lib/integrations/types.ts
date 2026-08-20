/**
 * Shared integration types (browser-safe).
 *
 * Providers normalize vendor payloads into CanonicalWebhookEvent so automations
 * and prompt templates stay provider-agnostic.
 */

export type IntegrationProviderId =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'jira'
  | 'linear'
  | 'azure-devops'

export type WebhookEventCatalogEntry = {
  id: string
  label: string
  description?: string
}

export type CanonicalIssue = {
  id: string
  key: string
  title: string
  body: string
  url: string
  status: string
  previousStatus: string
  labels: string[]
  assignees: string[]
  project: string
  priority: string
}

export type CanonicalActor = {
  name: string
  email: string
}

/** Normalized webhook event every provider emits after parse. */
export type CanonicalWebhookEvent = {
  provider: IntegrationProviderId
  /** Stable event id within the provider, e.g. `issues.opened`. */
  eventType: string
  /** Vendor delivery id used for idempotency. */
  deliveryId: string
  occurredAt: number | null
  issue: CanonicalIssue
  actor: CanonicalActor
  /** Extra key/value pairs available to prompt templates as {{extra.*}}. */
  extra: Record<string, string>
}

/** Optional filters stored on an automation (JSON on the task row). */
export type WebhookFilters = {
  /** If non-empty, issue must carry at least one of these labels (case-insensitive). */
  labels?: string[]
  /** If non-empty, issue project/repo/team must match one (case-insensitive). */
  projects?: string[]
  /** If set, only fire when status equals one of these (case-insensitive). */
  statuses?: string[]
  /** If set, only fire when previousStatus equals one of these. */
  previousStatuses?: string[]
  /** If non-empty, issue must be assigned to at least one of these names. */
  assignees?: string[]
}

export type ProviderMeta = {
  id: IntegrationProviderId
  label: string
  description: string
  events: WebhookEventCatalogEntry[]
  /** Short setup steps shown on the provider detail page. */
  setupSteps: string[]
  /** Docs URL for the vendor webhook UI. */
  docsUrl: string
  /**
   * True when relayed events for this provider fill `extra.comment` with the
   * comment body. A prompt that interpolates `{{extra.comment}}` on a provider that
   * does not renders an empty line, so anything offering a comment-driven
   * template has to check this rather than assume a comment event carries text.
   */
  emitsCommentText: boolean
}

export function emptyIssue(partial?: Partial<CanonicalIssue>): CanonicalIssue {
  return {
    id: '',
    key: '',
    title: '',
    body: '',
    url: '',
    status: '',
    previousStatus: '',
    labels: [],
    assignees: [],
    project: '',
    priority: '',
    ...partial,
  }
}

export function emptyActor(partial?: Partial<CanonicalActor>): CanonicalActor {
  return {
    name: '',
    email: '',
    ...partial,
  }
}
