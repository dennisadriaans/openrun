/**
 * Turn a connected integration into a working automation.
 *
 * Connecting a provider is only half the job the user came for: until some
 * automation binds the connection, every delivery arrives and matches nothing.
 * The connection itself is made by the control-plane round-trip; this is what
 * turns it into something that runs.
 */
import {
  bindAutomationEvents,
  defaultAutomationName,
  defaultAutomationPrompt,
} from '../../lib/integrations/automation.ts'
import { providerMeta } from '../../lib/integrations/catalog.ts'
import {
  compileTrigger,
  describeTrigger,
  type IntegrationTrigger,
} from '../../lib/integrations/triggers.ts'
import type { WebhookFilters } from '../../lib/integrations/types.ts'
import { getDb, type RuntimeRow } from '../db.ts'
import { checkRuntimeInstalled } from '../runtimePath.ts'
import { listProjects } from '../workspaces.ts'
import { getIntegration } from './connections.ts'

export type AutomationSetupContext = {
  runtimes: Array<{ id: string; label: string; bin: string; installed: boolean }>
  projects: Array<{
    id: string
    name: string
    remoteUrl: string
    workspaces: Array<{ id: string; name: string; status: string; kind: string }>
  }>
}

/** Everything the "finish setup" form picks from: runtimes and workspaces. */
export function getAutomationSetupContext(): AutomationSetupContext {
  const projects: AutomationSetupContext['projects'] = listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    remoteUrl: p.remoteUrl,
    workspaces: getDb()
      .prepare(
        `SELECT id, name, status, kind FROM workspaces
         WHERE projectId = ? AND status != 'archived'
         ORDER BY kind = 'main' DESC, createdAt ASC`,
      )
      .all(p.id) as Array<{ id: string; name: string; status: string; kind: string }>,
  }))

  const runtimes = (
    getDb().prepare('SELECT * FROM runtimes ORDER BY createdAt ASC').all() as RuntimeRow[]
  ).map((r) => ({
    id: r.id,
    label: r.label,
    bin: r.bin,
    installed: checkRuntimeInstalled(r.bin).installed,
  }))

  return { runtimes, projects }
}

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
