/**
 * The app's half of a hosted integration.
 *
 * The control plane owns the vendor OAuth app, the tokens, and the webhook; the
 * only thing that lands here is a local row that binds a `cloudConnectionId` to
 * automations, so a relayed `CanonicalWebhookEvent` has somewhere to dispatch.
 * No vendor credential ever reaches this process.
 */
import { isIntegrationProviderId, providerMeta } from '../../lib/integrations/catalog.ts'
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from '../../lib/integrations/types.ts'
import { CLOUD_PATHS, integrationConnectionPath } from '../../lib/cloud/url.ts'
import {
  createIntegration,
  deleteIntegration,
  findIntegrationByCloudConnection,
  getIntegration,
  getIntegrationPublic,
  type IntegrationPublic,
} from '../integrations/connections.ts'
import { getDb } from '../db.ts'
import { cloudConnectionIdFromConfig } from '../../lib/integrations/automation.ts'
import { parseWebhookEvents, parseWebhookFilters } from '../../lib/integrations/match.ts'
import { testEventShape, type TestEventBinding } from '../../lib/integrations/testEvent.ts'
import { ingestCanonicalEvent } from '../integrations/dispatcher.ts'
import { hostedDisconnectDecision } from '../../lib/cloud/hostedDisconnect.ts'
import { configuredCloudUrl, currentAccessToken } from './login.ts'
import { clearConnectPending, readConnectPending, readCloudSession } from './session.ts'

/** A connect left half-finished is abandoned rather than resumed. */
const CONNECT_TTL_MS = 15 * 60 * 1000

export type HostedConnectInput = {
  provider: string
  cloudConnectionId: string
  /** Echoed back by the control plane; matched against the pending record. */
  state?: string
  siteUrl?: string
  accountName?: string
}

/**
 * Finish a connect the browser started. The provider comes from the pending
 * record rather than the query string — the redirect is attacker-reachable on
 * loopback, and a mismatched provider would file a GitHub connection as Jira.
 */
export function completeHostedConnect(input: HostedConnectInput): IntegrationPublic {
  if (!readCloudSession()) throw new Error('Sign in first.')

  const cloudConnectionId = input.cloudConnectionId.trim()
  if (!cloudConnectionId) throw new Error('Missing cloud connection id.')

  const pending = readConnectPending()
  if (!pending) throw new Error('No connection in progress. Start Connect again.')
  if (Date.now() - pending.createdAt > CONNECT_TTL_MS) {
    clearConnectPending()
    throw new Error('This connection link expired. Start Connect again.')
  }
  if (input.state && input.state !== pending.state) {
    throw new Error('Connection state mismatch. Start Connect again.')
  }
  if (input.provider && input.provider !== pending.provider) {
    throw new Error('Connection provider mismatch. Start Connect again.')
  }

  const provider = pending.provider
  if (!isIntegrationProviderId(provider)) {
    throw new Error(`Unknown integration provider: ${provider}`)
  }

  const existing = findIntegrationByCloudConnection(cloudConnectionId)
  if (existing) {
    clearConnectPending()
    const pub = getIntegrationPublic(existing.id)
    if (!pub) throw new Error('Integration not found')
    return pub
  }

  const siteUrl = (input.siteUrl ?? '').trim()
  const accountName = (input.accountName ?? '').trim()
  const label = providerMeta(provider)?.label ?? provider
  const row = createIntegration({
    provider,
    name: accountName || (siteUrl ? `${label} (${siteUrl})` : label),
    config: {
      installMethod: 'hosted',
      cloudConnectionId,
      installedAt: Date.now(),
      ...(siteUrl ? { siteUrl } : {}),
      ...(accountName ? { accountName } : {}),
      // Kept for connections written before the config carried a plain siteUrl.
      ...(provider === 'jira' && siteUrl ? { jira: { siteUrl } } : {}),
    },
  })
  clearConnectPending()
  return row
}

async function cloudRequest(path: string, init: RequestInit): Promise<Response> {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) throw new Error('Cloud is turned off.')
  const accessToken = await currentAccessToken()
  if (!accessToken) throw new Error('Sign in first.')
  return fetch(`${cloudUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${accessToken}` },
  })
}

export type HostedConnectionSummary = {
  id: string
  provider: string
  accountName: string
  siteUrl: string
  target: { id: string; name: string } | null
  status: string
  statusMessage: string
  lastEventAt: number | null
  createdAt: number
}

/**
 * Vendor-side state for this account's hosted connections. `status` /
 * `statusMessage` are rendered verbatim: a webhook whose renewal failed has to
 * say so in the app rather than go quiet.
 */
export async function listHostedConnections(): Promise<HostedConnectionSummary[]> {
  if (!readCloudSession() || !configuredCloudUrl()) return []
  try {
    const res = await cloudRequest(CLOUD_PATHS.connections, { method: 'GET' })
    if (!res.ok) return []
    const body = (await res.json()) as { connections?: HostedConnectionSummary[] }
    return body.connections ?? []
  } catch {
    return []
  }
}

/**
 * Remove a hosted connection. The control plane revokes first so deliveries
 * stop even if Atlassian refuses the delete; this process then drops the local
 * row on 200/404. A 401 or a network error keeps the row so a later attempt
 * can still reach the vendor hook.
 */
export async function disconnectHostedIntegration(integrationId: string): Promise<{
  ok: boolean
  remoteError?: string
}> {
  const integration = getIntegration(integrationId)
  if (!integration) throw new Error('Integration not found')

  const cloudConnectionId = cloudConnectionIdFromConfig(integration.config)
  if (!cloudConnectionId) {
    deleteIntegration(integrationId)
    return { ok: true }
  }

  try {
    const res = await cloudRequest(integrationConnectionPath(cloudConnectionId), {
      method: 'DELETE',
    })
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      remoteError?: string
      remoteRemoved?: boolean
    }
    const decision = hostedDisconnectDecision(res.status, body)
    if (!decision.dropLocal) {
      return { ok: false, remoteError: decision.error }
    }
    deleteIntegration(integrationId)
    return { ok: true, remoteError: decision.warning }
  } catch (err) {
    return {
      ok: false,
      remoteError: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Enabled automations bound to this connection, newest binding first, so the
 * test event can be shaped like something they actually watch.
 */
function bindingsFor(integrationId: string): TestEventBinding[] {
  const rows = getDb()
    .prepare(
      `SELECT webhookEvents, webhookFilters FROM tasks
       WHERE webhookIntegrationId = ? AND enabled = 1
       ORDER BY createdAt DESC`,
    )
    .all(integrationId) as Array<{ webhookEvents: string; webhookFilters: string }>
  return rows.map((row) => ({
    events: parseWebhookEvents(row.webhookEvents),
    filters: parseWebhookFilters(row.webhookFilters),
  }))
}

export async function ingestTestEvent(integrationId: string): Promise<{
  ok: boolean
  matched: number
  runIds: string[]
  /** The event that was sent, so the UI can name it rather than just count. */
  eventType: string
  error?: string
}> {
  const integration = getIntegration(integrationId)
  if (!integration) throw new Error('Integration not found')

  const shape = testEventShape(integration.provider, bindingsFor(integrationId))
  const event: CanonicalWebhookEvent = {
    provider: integration.provider,
    eventType: shape.eventType,
    deliveryId: `test_${Date.now()}`,
    occurredAt: Date.now(),
    issue: emptyIssue({
      id: 'test',
      key: 'TEST-1',
      title: 'Test webhook event',
      body: 'Sent from Open Run to verify matching and runs.',
      url: '',
      status: shape.status,
      previousStatus: shape.previousStatus,
      labels: shape.labels,
      assignees: shape.assignees,
      project: shape.project,
    }),
    actor: emptyActor({ name: 'Open Run' }),
    extra: { source: 'test' },
  }

  const result = await ingestCanonicalEvent(integrationId, event)
  const runs = Array.isArray(result.body.runs)
    ? (result.body.runs as Array<{ runId?: string }>)
    : []
  return {
    ok: result.ok,
    matched: Number(result.body.matched ?? 0),
    runIds: runs.map((row) => row.runId).filter((id): id is string => Boolean(id)),
    eventType: shape.eventType,
    error: result.ok ? undefined : String(result.body.error ?? 'ingest failed'),
  }
}
