import { parseWebhookEvents, parseWebhookFilters } from './integrations/match.ts'

/** Stored automation fields needed to seed the edit form without lossy remapping. */
export type TaskFormInitialSource = {
  id: string
  name: string
  description: string
  runtimeId: string
  prompt: string
  workspaceId: string
  cron: string
  webhookIntegrationId: string
  webhookEvents: string
  webhookFilters: string
  enabled: number
  model: string
  effort: string
  verifyEnabled: number
  maxRepairAttempts: number
  timeoutMs: number
  resumeSessionId: string
  resumeSessionLabel: string
  fireOnce: number
}

/**
 * Keep the route-to-form boundary in one tested adapter. Hand-picking fields in
 * the route previously cleared native-session and one-shot settings on save.
 */
export function taskFormInitial(task: TaskFormInitialSource) {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    runtimeId: task.runtimeId,
    prompt: task.prompt,
    workspaceId: task.workspaceId,
    cron: task.cron,
    webhookIntegrationId: task.webhookIntegrationId,
    webhookEvents: parseWebhookEvents(task.webhookEvents),
    webhookFilters: parseWebhookFilters(task.webhookFilters),
    enabled: Boolean(task.enabled),
    model: task.model,
    effort: task.effort,
    verifyEnabled: task.verifyEnabled,
    maxRepairAttempts: task.maxRepairAttempts,
    timeoutMs: task.timeoutMs,
    resumeSessionId: task.resumeSessionId,
    resumeSessionLabel: task.resumeSessionLabel,
    fireOnce: task.fireOnce,
  }
}
