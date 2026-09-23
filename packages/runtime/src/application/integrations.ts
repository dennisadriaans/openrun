/** integrations capability implementation. */
import type { WebhookFilters } from '@openrun/domain/integrations/types'
import {
  createIntegrationAutomation as createIntegrationAutomationRow,
  type CreateIntegrationAutomationInput,
} from '../integrations/index.ts'
import { listDeliveriesForIntegration, listRecentDeliveries } from '../integrations/index.ts'

import { upsertTask } from './taskCommands.ts'

export {
  createIntegration,
  deleteIntegration,
  getAutomationSetupContext,
  getIntegrationPublic,
  listDeliveriesForIntegration,
  listIntegrations,
  listProviderCatalog,
  listRecentDeliveries,
  updateIntegration,
  type AutomationSetupContext,
  type CreateIntegrationAutomationInput,
  type CreateIntegrationInput,
  type IntegrationPublic,
  type UpdateIntegrationInput,
} from '../integrations/index.ts'

/** The one place an integration turns into a task row. */
function writeIntegrationAutomation(args: {
  name: string
  description: string
  runtimeId: string
  prompt: string
  workspaceId: string
  enabled: boolean
  webhookIntegrationId: string
  webhookEvents: string[]
  webhookFilters?: WebhookFilters
}): { id: string } {
  const task = upsertTask({
    name: args.name,
    description: args.description,
    runtimeId: args.runtimeId,
    prompt: args.prompt,
    cwd: '',
    workspaceId: args.workspaceId,
    cron: '',
    enabled: args.enabled,
    webhookIntegrationId: args.webhookIntegrationId,
    webhookEvents: args.webhookEvents,
    webhookFilters: args.webhookFilters ?? {},
  })
  return { id: task.id }
}

/** Wire an already-connected integration to a workspace and runtime. */
export function createIntegrationAutomation(input: CreateIntegrationAutomationInput) {
  return createIntegrationAutomationRow(input, { createAutomation: writeIntegrationAutomation })
}

/**
 * Webhook deliveries, scoped to one integration or across all of them.
 *
 * The branch used to live in the server function. Moved here so every
 * transport asks one question and gets one answer.
 */
export function listWebhookDeliveries(input: { integrationId?: string; limit?: number } = {}) {
  if (input.integrationId) {
    return listDeliveriesForIntegration(input.integrationId, input.limit ?? 30)
  }
  return listRecentDeliveries(input.limit ?? 50)
}
