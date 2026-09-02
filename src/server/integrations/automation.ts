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
import { PICK_RUNTIME_MESSAGE, PICK_WORKSPACE_MESSAGE } from '../../lib/integrations/setupGate.ts'
import type { WebhookFilters } from '../../lib/integrations/types.ts'
import { getDb, type RuntimeRow } from '../db.ts'
import { checkRuntimeInstalled } from '../runtimePath.ts'
import { getIntegration } from './connections.ts'

export type AutomationSetupContext = {
  runtimes: Array<{ id: string; label: string; bin: string; installed: boolean }>
}

/**
 * The half of the "finish setup" form the app cannot already answer.
 *
 * Projects and workspaces are deliberately absent: `WorkspacePicker` owns that
 * pair everywhere else, including creating a project when there is none, and a
 * second listing here would be one more thing to keep in step. `installed` is
 * the part only the server knows — a runtime whose binary is off PATH cannot
 * arm an automation.
 */
export function getAutomationSetupContext(): AutomationSetupContext {
  const runtimes = (
    getDb().prepare('SELECT * FROM runtimes ORDER BY createdAt ASC').all() as RuntimeRow[]
  ).map((r) => ({
    id: r.id,
    label: r.label,
    bin: r.bin,
    installed: checkRuntimeInstalled(r.bin).installed,
  }))

  return { runtimes }
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
  if (!workspaceId) throw new Error(PICK_WORKSPACE_MESSAGE)

  const runtimeId = input.runtimeId.trim()
  if (!runtimeId) throw new Error(PICK_RUNTIME_MESSAGE)
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
