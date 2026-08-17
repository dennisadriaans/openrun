/**
 * The app's half of a hosted integration.
 *
 * The control plane owns the vendor OAuth app, the tokens, and the webhook; the
 * only thing that lands here is a local row that binds a `cloudConnectionId` to
 * automations, so a relayed `CanonicalWebhookEvent` has somewhere to dispatch.
 * No vendor credential ever reaches this process.
 */
import { isIntegrationProviderId, providerMeta } from '../../lib/integrations/catalog.ts'
import {
  emptyActor,
  emptyIssue,
  type CanonicalWebhookEvent,
  type IntegrationProviderId,
} from '../../lib/integrations/types.ts'
import { CLOUD_PATHS, integrationConnectionPath } from '../../lib/cloud/url.ts'
import {
  createIntegration,
  deleteIntegration,
  findIntegrationByCloudConnection,
  getIntegration,
  getIntegrationPublic,
  type IntegrationPublic,
} from '../integrations/connections.ts'
import { cloudConnectionIdFromConfig } from '../../lib/integrations/install.ts'
import { ingestCanonicalEvent } from '../integrations/dispatcher.ts'
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
 * Remove a hosted connection. The control plane deletes the vendor-side webhook
 * first: dropping only the local row would leave the vendor posting events at
 * the Worker forever with nothing to deliver them to.
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

  let remoteError: string | undefined
  try {
    const res = await cloudRequest(integrationConnectionPath(cloudConnectionId), {
      method: 'DELETE',
    })
    // 404 means the control plane already forgot it; nothing left to revoke.
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      remoteError = body.error || `The control plane refused to disconnect (${res.status}).`
    }
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err)
  }

  if (remoteError) return { ok: false, remoteError }
  deleteIntegration(integrationId)
  return { ok: true }
}

/** Event id each provider fires first, so a test event matches a real binding. */
const TEST_EVENT_TYPE: Record<IntegrationProviderId, string> = {
  github: 'issues.opened',
  gitlab: 'issue.open',
  bitbucket: 'issue:created',
  jira: 'jira:issue_created',
  linear: 'Issue.create',
  'azure-devops': 'workitem.created',
}

export async function ingestTestEvent(integrationId: string): Promise<{
  ok: boolean
  matched: number
  runIds: string[]
  error?: string
}> {
  const integration = getIntegration(integrationId)
  if (!integration) throw new Error('Integration not found')

  const event: CanonicalWebhookEvent = {
    provider: integration.provider,
    eventType: TEST_EVENT_TYPE[integration.provider] ?? 'issues.opened',
    deliveryId: `test_${Date.now()}`,
    occurredAt: Date.now(),
    issue: emptyIssue({
      id: 'test',
      key: 'TEST-1',
      title: 'Test webhook event',
      body: 'Sent from Open Run to verify matching and runs.',
      url: '',
      status: 'To Do',
      assignees: ['Ada'],
      project: 'TEST',
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
    error: result.ok ? undefined : String(result.body.error ?? 'ingest failed'),
  }
}
