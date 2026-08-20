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
  bindAutomationEvents,
  defaultAutomationName,
  defaultAutomationPrompt,
} from '../../lib/integrations/install.ts'
import { providerMeta } from '../../lib/integrations/catalog.ts'
import {
  compileTrigger,
  describeTrigger,
  type IntegrationTrigger,
} from '../../lib/integrations/triggers.ts'
import type { WebhookFilters } from '../../lib/integrations/types.ts'
import { getDb, type RuntimeRow } from '../db.ts'
import { getIntegration } from './connections.ts'

export type CreateIntegrationAutomationInput = {
  integrationId: string
  workspaceId: string
  runtimeId: string
  /**
   * The trigger in the user's terms. Compiled here rather than in the browser
   * so the sentence the form previews and the binding this writes cannot drift.
   */
  trigger?: IntegrationTrigger
  /** Raw catalog event ids, used only when no trigger is given. */
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
  webhookFilters: WebhookFilters
}) => { id: string }

export function createIntegrationAutomation(
  input: CreateIntegrationAutomationInput,
  deps: { createAutomation: IntegrationAutomationWriter },
): { taskId: string; events: string[]; filters: WebhookFilters } {
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

  const compiled = input.trigger
    ? compileTrigger(integration.provider, input.trigger)
    : { events: input.events ?? [], filters: {} as WebhookFilters }

  // Narrowed even for a compiled trigger: the table only holds catalog ids
  // today, and this is the one place that guarantees it stays true.
  const events = bindAutomationEvents(
    integration.provider,
    compiled.events,
    meta.events.map((event) => event.id),
    { allowEmpty: input.trigger?.kind === 'custom' },
  )
  const description = input.trigger
    ? describeTrigger(integration.provider, input.trigger)
    : `Runs when ${meta.label} sends ${events.join(', ')}.`

  const prompt = input.prompt?.trim() || defaultAutomationPrompt(integration.provider)
  const name = input.name?.trim() || defaultAutomationName(integration.provider, integration.name)

  const task = deps.createAutomation({
    name,
    description,
    runtimeId,
    prompt,
    workspaceId,
    enabled: input.enabled !== false,
    webhookIntegrationId: integration.id,
    webhookEvents: events,
    webhookFilters: compiled.filters,
  })

  return { taskId: task.id, events, filters: compiled.filters }
}
