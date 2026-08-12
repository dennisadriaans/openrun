/**
 * After Jira OAuth on the Worker, create a local hosted connection row
 * (no signing secret) and optional test ingest.
 */
import { emptyActor, emptyIssue, type CanonicalWebhookEvent } from '../../lib/integrations/types.ts'
import {
  createIntegration,
  findIntegrationByCloudConnection,
  getIntegration,
  getIntegrationPublic,
  type IntegrationPublic,
} from '../integrations/connections.ts'
import { ingestCanonicalEvent } from '../integrations/dispatcher.ts'
import { readCloudSession } from './session.ts'

export function completeHostedJiraConnect(input: {
  cloudConnectionId: string
  siteUrl?: string
  name?: string
}): IntegrationPublic {
  if (!readCloudSession()) throw new Error('Sign in first.')
  const cloudConnectionId = input.cloudConnectionId.trim()
  if (!cloudConnectionId) throw new Error('Missing cloud connection id.')

  const existing = findIntegrationByCloudConnection(cloudConnectionId)
  if (existing) {
    const pub = getIntegrationPublic(existing.id)
    if (!pub) throw new Error('Integration not found')
    return pub
  }

  const siteUrl = (input.siteUrl ?? '').trim()
  return createIntegration({
    provider: 'jira',
    name: input.name?.trim() || (siteUrl ? `Jira (${siteUrl})` : 'Jira'),
    config: {
      installMethod: 'hosted',
      cloudConnectionId,
      installedAt: Date.now(),
      ...(siteUrl ? { jira: { siteUrl } } : {}),
    },
  })
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
    eventType:
      integration.provider === 'jira'
        ? 'jira:issue_created'
        : integration.provider === 'linear'
          ? 'Issue.create'
          : 'issues.opened',
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
