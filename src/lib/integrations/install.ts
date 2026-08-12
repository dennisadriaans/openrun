/**
 * Browser-safe install helpers — defaults, URL checks, and shared types for
 * one-click provider install (no Open Run env vars required).
 */
import type { IntegrationProviderId } from './types.ts'
import { providerMeta } from './catalog.ts'

/** localStorage key for the last public base URL the developer used. */
export const PUBLIC_BASE_URL_STORAGE_KEY = 'agentops.publicBaseUrl'

export type InstallAutomationInput = {
  /** When true, create an automation wired to this connection. Default true. */
  create?: boolean
  name?: string
  prompt?: string
  workspaceId: string
  runtimeId: string
  /** Default true when workspace + runtime are ready. */
  enabled?: boolean
}

export type GitHubInstallCredentials = {
  owner: string
  repo: string
}

export type LinearInstallCredentials = {
  /** Personal API key (lin_api_…). Used once to register the webhook; not stored. */
  apiKey: string
}

export type JiraInstallCredentials = {
  /** e.g. https://your-site.atlassian.net */
  siteUrl: string
  email: string
  /** Atlassian API token — used once; not stored. */
  apiToken: string
  /** Optional JQL fragment / project filter applied on the remote webhook. */
  jql?: string
}

export function cloudConnectionIdFromConfig(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw || '{}') as { installMethod?: unknown; cloudConnectionId?: unknown }
    if (parsed.installMethod !== 'hosted') return null
    return typeof parsed.cloudConnectionId === 'string' && parsed.cloudConnectionId.trim()
      ? parsed.cloudConnectionId.trim()
      : null
  } catch {
    return null
  }
}

export type InstallIntegrationInput = {
  provider: IntegrationProviderId
  name?: string
  /**
   * Absolute origin providers will POST to (https://….ngrok.app or a deployed
   * host). Optional — without it we still create a local endpoint to paste.
   */
  publicBaseUrl?: string
  /** Automation event ids to listen for (catalog ids). Empty = provider defaults. */
  events?: string[]
  automation?: InstallAutomationInput
  github?: GitHubInstallCredentials
  linear?: LinearInstallCredentials
  jira?: JiraInstallCredentials
}

/** Sensible defaults so Install works without picking every event. */
export const DEFAULT_INSTALL_EVENTS: Record<IntegrationProviderId, string[]> = {
  github: ['issues.opened'],
  jira: ['jira:issue_created', 'jira:issue_status_changed'],
  linear: ['Issue.create', 'Issue.status_changed'],
}

/** GitHub repo hook event names derived from our catalog issue event ids. */
export function githubHookEventsFromCatalog(catalogEventIds: string[]): string[] {
  const set = new Set<string>()
  for (const id of catalogEventIds) {
    if (id.startsWith('issues.')) set.add('issues')
  }
  if (set.size === 0) set.add('issues')
  return [...set]
}

/** Linear resourceTypes for webhookCreate. */
export function linearResourceTypesFromCatalog(catalogEventIds: string[]): string[] {
  const set = new Set<string>()
  for (const id of catalogEventIds) {
    if (id.startsWith('Issue.')) set.add('Issue')
    else if (id.startsWith('Comment.')) set.add('Comment')
    else if (id.startsWith('Project.')) set.add('Project')
    else if (id.startsWith('Cycle.')) set.add('Cycle')
  }
  if (set.size === 0) set.add('Issue')
  return [...set]
}

/** Jira admin webhook event names (derived events are local-only). */
export function jiraRemoteEventsFromCatalog(catalogEventIds: string[]): string[] {
  const derived = new Set([
    'jira:issue_status_changed',
    'jira:issue_assigned',
  ])
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of catalogEventIds) {
    if (derived.has(id)) {
      if (!seen.has('jira:issue_updated')) {
        seen.add('jira:issue_updated')
        out.push('jira:issue_updated')
      }
      continue
    }
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  if (out.length === 0) {
    out.push('jira:issue_created', 'jira:issue_updated')
  }
  return out
}

export function defaultInstallEvents(provider: IntegrationProviderId): string[] {
  return [...DEFAULT_INSTALL_EVENTS[provider]]
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

/**
 * Public origin we can register with a provider. Empty and localhost are
 * skipped (local endpoint only); anything else must pass assertPublicBaseUrl.
 */
export function remoteInstallBaseUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed || isLikelyLocalhostUrl(trimmed)) return null
  return assertPublicBaseUrl(trimmed)
}

export function isLikelyLocalhostUrl(url: string): boolean {
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local')
    )
  } catch {
    return false
  }
}

/**
 * Normalize and validate a public base URL providers can reach.
 * Rejects empty / relative / localhost (providers cannot POST to your laptop).
 */
export function assertPublicBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error(
      'Enter a public base URL (Cloudflare Tunnel, ngrok, or your deployed host) so the provider can reach Open Run.',
    )
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Public base URL must be absolute, e.g. https://abc.ngrok-free.app')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Public base URL must start with https:// (or http:// for a local tunnel).')
  }
  if (isLikelyLocalhostUrl(trimmed)) {
    throw new Error(
      'Providers cannot reach localhost. Paste a tunnel URL (Cloudflare Tunnel / ngrok) or your deployed Open Run origin.',
    )
  }
  return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`
}

/** Parse owner/repo from a git remote or "owner/repo" string. */
export function parseGithubOwnerRepo(input: string): { owner: string; repo: string } | null {
  const raw = input.trim()
  if (!raw) return null
  const slim = raw
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/$/, '')
  const m = slim.match(/^([^/]+)\/([^/]+)$/)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]! }
}

export function readStoredPublicBaseUrl(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    return localStorage.getItem(PUBLIC_BASE_URL_STORAGE_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function storePublicBaseUrl(url: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    const trimmed = url.trim()
    if (!trimmed) localStorage.removeItem(PUBLIC_BASE_URL_STORAGE_KEY)
    else localStorage.setItem(PUBLIC_BASE_URL_STORAGE_KEY, trimmed)
  } catch {
    // ignore quota / private mode
  }
}
