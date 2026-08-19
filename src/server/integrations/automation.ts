/**
 * Turn a connected integration into a working automation.
 *
 * Connecting a provider is only half the job the user came for: until some
 * automation binds the connection, every delivery arrives and matches nothing.
 * This is the second half, kept separate from `install.ts` because a hosted
 * connection is created by the control plane round-trip, not by the local
 * install path — but both end here.
 */
import {
  defaultAutomationName,
  defaultAutomationPrompt,
  resolveAutomationEvents,
} from '../../lib/integrations/install.ts'
import { providerMeta } from '../../lib/integrations/catalog.ts'
import { getDb, type RuntimeRow } from '../db.ts'
import { getIntegration } from './connections.ts'

export type CreateIntegrationAutomationInput = {
  integrationId: string
  workspaceId: string
  runtimeId: string
  /** Catalog event ids to fire on. Empty falls back to the provider defaults. */
  events?: string[]
  name?: string
  prompt?: string
  /** Default true — an automation nobody enabled never runs. */
  enabled?: boolean
}

export type IntegrationAutomationWriter = (input: {
  name: string
  description: string
  runtimeId: string
  prompt: string
  workspaceId: string
  enabled: boolean
  webhookIntegrationId: string
  webhookEvents: string[]
}) => { id: string }

export function createIntegrationAutomation(
  input: CreateIntegrationAutomationInput,
  deps: { createAutomation: IntegrationAutomationWriter },
): { taskId: string; events: string[] } {
  const integration = getIntegration(input.integrationId)
  if (!integration) throw new Error('Integration not found')

  const meta = providerMeta(integration.provider)
  if (!meta) throw new Error(`Unknown provider: ${integration.provider}`)

  const workspaceId = input.workspaceId.trim()
  if (!workspaceId) throw new Error('Pick a project workspace for the automation.')

  const runtimeId = input.runtimeId.trim()
  if (!runtimeId) throw new Error('Pick a runtime for the automation.')
  const runtime = getDb().prepare('SELECT id FROM runtimes WHERE id = ?').get(runtimeId) as
    | Pick<RuntimeRow, 'id'>
    | undefined
  if (!runtime) throw new Error('Runtime not found')

  const events = resolveAutomationEvents(
    integration.provider,
    input.events,
    meta.events.map((event) => event.id),
  )
  const prompt = input.prompt?.trim() || defaultAutomationPrompt(integration.provider)
  const name = input.name?.trim() || defaultAutomationName(integration.provider, integration.name)

  const task = deps.createAutomation({
    name,
    description: `Runs when ${meta.label} sends ${events.join(', ')}.`,
    runtimeId,
    prompt,
    workspaceId,
    enabled: input.enabled !== false,
    webhookIntegrationId: integration.id,
    webhookEvents: events,
  })

  return { taskId: task.id, events }
}
