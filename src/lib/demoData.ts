/**
 * Sample Runs + Automations for screenshots. `pnpm dev -- --demo` sets
 * OPENRUN_DEMO=1; lists overlay this on top of the real DB (nothing is written).
 */
import type { TaskWithMeta } from '../fns'
import { taskActions } from './actions.ts'

export function isDemoMode(): boolean {
  const raw = (process.env.OPENRUN_DEMO ?? process.env.AGENTOPS_DEMO ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export type DemoRun = {
  id: string
  status: string
  chatTitle: string
  activitySummary: string
  runtimeLabel: string
  trigger: 'chat' | 'manual' | 'schedule' | 'webhook'
  startedAt: number
  finishedAt: number | null
  unread?: boolean
}

export const DEMO_RUNNING_TASK_ID = 'demo-task-1'
export const DEMO_DETAIL_TASK_ID = DEMO_RUNNING_TASK_ID
export const DEMO_DETAIL_RUN_ID = 'demo-run-5'

export function isDemoDetailTask(taskId: string): boolean {
  return taskId === DEMO_DETAIL_TASK_ID
}

export function isDemoDetailRun(runId: string): boolean {
  return runId === DEMO_DETAIL_RUN_ID
}

export function demoTaskDetail(taskId: string, now: number = Date.now()): TaskWithMeta | null {
  if (!isDemoDetailTask(taskId)) return null

  const cwd = '/Users/demo/Developer/open-run-nightly-deps'
  // Annotated so the literal keeps its contextual types — `workspaceHealth.code`
  // widens to `string` without it.
  const task: Omit<TaskWithMeta, 'actions'> = {
    id: taskId,
    name: 'Nightly dependency bump',
    description: 'Keep dependencies current and leave a reviewed pull request ready each morning.',
    runtimeId: 'grok',
    prompt: `Review the workspace for outdated dependencies.

Apply safe patch and minor updates, update the lockfile, and run the existing checks. Summarize anything that needs a manual major-version migration.`,
    cwd,
    workspaceId: 'demo-workspace-nightly-deps',
    cron: '0 18 * * *',
    enabled: 1,
    model: '',
    effort: 'high',
    webhookIntegrationId: '',
    webhookEvents: '[]',
    webhookFilters: '{}',
    verifyEnabled: 1,
    maxRepairAttempts: 1,
    timeoutMs: 30 * 60_000,
    resumeSessionId: '',
    resumeSessionLabel: '',
    fireOnce: 0,
    scheduledAt: 0,
    requireIsolation: 1,
    requireGhAuth: 1,
    createdAt: now - 30 * 86400_000,
    updatedAt: now - 2 * 86400_000,
    lastRunAt: now - 2 * 60_000,
    runtimeLabel: 'Grok CLI',
    nextRunAt: now + 20 * 60_000,
    cronValid: true,
    workspaceValid: true,
    workspaceReady: true,
    workspaceStatus: 'ready',
    runtimeInstalled: true,
    runtimeValid: true,
    runtimeBin: 'grok',
    promptValid: true,
    resumeSessionValid: true,
    checkCount: 3,
    queuedCount: 0,
    effectiveTimeoutMs: 30 * 60_000,
    lastScheduleFire: null,
    workspaceKind: 'worktree',
    workspaceHealth: {
      code: 'ok',
      path: cwd,
      configuredBranch: 'chore/nightly-dependencies',
      actualBranch: 'chore/nightly-dependencies',
      dirty: false,
      detail: '',
    },
    requiresGh: true,
    ghInstalled: true,
    ghAuthenticated: true,
    unattendedBlockedReason: null,
    activeRunId: null,
    promptDeliveryValid: true,
    promptDeliveryReason: null,
    triggerReady: true,
    triggerBlockReason: null,
    readinessBlockers: [],
  }
  // Demo rows go through the same gates as real ones, so the sample screens
  // show the controls in the state the rules actually produce.
  return { ...task, actions: taskActions(task) }
}

export type DemoTask = {
  id: string
  name: string
  runtimeLabel: string
  enabled: number
  cron: string
  webhookIntegrationId: string
  queuedCount: number
  nextRunAt: number | null
  lastRunAt: number | null
  workspaceValid: boolean
  workspaceReady: boolean
  runtimeInstalled: boolean
  promptValid: boolean
  lastScheduleFire?: {
    observedAt: number
    outcome: 'started' | 'queued' | 'skipped' | 'failed' | 'missed'
    detail: string
  } | null
  /** Demo automations are always AFK-safe; declared so the list narrows. */
  unattendedBlockedReason?: string | null
}

export function demoRuns(now: number = Date.now()): DemoRun[] {
  return [
    {
      id: 'demo-run-1',
      status: 'running',
      chatTitle: 'Wire Stripe checkout for the waitlist',
      activitySummary: 'Editing CheckoutForm.tsx',
      runtimeLabel: 'Claude Code',
      trigger: 'chat',
      startedAt: now - 2 * 60_000,
      finishedAt: null,
    },
    {
      id: 'demo-run-2',
      status: 'success',
      chatTitle: 'Kill the dark-mode flash on pricing',
      activitySummary: 'Edited ThemeToggle.tsx, globals.css',
      runtimeLabel: 'Codex CLI',
      trigger: 'chat',
      startedAt: now - 18 * 60_000,
      finishedAt: now - 4 * 60_000,
    },
    {
      id: 'demo-run-3',
      status: 'success',
      chatTitle: 'Linear webhook → create automations',
      activitySummary: 'Edited webhook.ts, recipes.ts',
      runtimeLabel: 'Claude Code',
      trigger: 'chat',
      startedAt: now - 2 * 3600_000,
      finishedAt: now - 1.7 * 3600_000,
    },
    {
      id: 'demo-run-4',
      status: 'error',
      chatTitle: 'Why does the nightly cron never fire?',
      activitySummary: 'Read scheduler.ts',
      runtimeLabel: 'Codex CLI',
      trigger: 'chat',
      startedAt: now - 3 * 3600_000,
      finishedAt: now - 2.9 * 3600_000,
    },
    {
      id: DEMO_DETAIL_RUN_ID,
      status: 'success',
      chatTitle: 'Polish the Vue waitlist landing',
      activitySummary: 'Edited WaitlistHero.vue, PricingCard.vue, ThemeToggle.vue',
      runtimeLabel: 'Claude Code',
      trigger: 'chat',
      startedAt: now - 5 * 3600_000,
      finishedAt: now - 4.6 * 3600_000,
    },
    {
      id: 'demo-run-6',
      status: 'success',
      chatTitle: 'Nightly dependency bump',
      activitySummary: 'Edited package.json, pnpm-lock.yaml',
      runtimeLabel: 'Grok CLI',
      trigger: 'schedule',
      startedAt: now - 8 * 3600_000,
      finishedAt: now - 8 * 3600_000 + 4 * 60_000,
    },
    {
      id: 'demo-run-7',
      status: 'success',
      chatTitle: 'Ship usage page with spend by model',
      activitySummary: 'Edited usage.tsx, usage.ts',
      runtimeLabel: 'Claude Code',
      trigger: 'chat',
      startedAt: now - 22 * 3600_000,
      finishedAt: now - 21.5 * 3600_000,
    },
    {
      id: 'demo-run-8',
      status: 'success',
      chatTitle: 'Seal MCP tokens at rest',
      activitySummary: 'Edited secretBox.ts, mcpOAuth.ts',
      runtimeLabel: 'Codex CLI',
      trigger: 'chat',
      startedAt: now - 26 * 3600_000,
      finishedAt: now - 25.4 * 3600_000,
    },
    {
      id: 'demo-run-9',
      status: 'success',
      chatTitle: 'On Linear issue moved to Ready',
      activitySummary: 'Edited automation.ts',
      runtimeLabel: 'Claude Code',
      trigger: 'webhook',
      startedAt: now - 2 * 86400_000,
      finishedAt: now - 2 * 86400_000 + 6 * 60_000,
    },
    {
      id: 'demo-run-10',
      status: 'success',
      chatTitle: 'Extract workspace picker from TaskForm',
      activitySummary: 'Edited WorkspacePicker.tsx',
      runtimeLabel: 'Gemini CLI',
      trigger: 'chat',
      startedAt: now - 3 * 86400_000,
      finishedAt: now - 3 * 86400_000 + 12 * 60_000,
    },
  ]
}

export function demoTasks(now: number = Date.now()): DemoTask[] {
  const healthy = {
    workspaceValid: true,
    workspaceReady: true,
    runtimeInstalled: true,
    promptValid: true,
  }
  return [
    {
      id: DEMO_RUNNING_TASK_ID,
      name: 'Nightly dependency bump',
      runtimeLabel: 'Grok CLI',
      enabled: 1,
      cron: '0 18 * * *',
      webhookIntegrationId: '',
      queuedCount: 1,
      nextRunAt: now + 20 * 60_000,
      lastRunAt: now - 2 * 60_000,
      ...healthy,
    },
    {
      id: 'demo-task-2',
      name: 'Linear Ready → start a run',
      runtimeLabel: 'Claude Code',
      enabled: 1,
      cron: '',
      webhookIntegrationId: 'linear',
      queuedCount: 0,
      nextRunAt: null,
      lastRunAt: now - 2 * 3600_000,
      ...healthy,
    },
    {
      id: 'demo-task-3',
      name: 'Morning changelog from git',
      runtimeLabel: 'Claude Code',
      enabled: 1,
      cron: '0 9 * * *',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: now + 10 * 3600_000,
      lastRunAt: now - 14 * 3600_000,
      ...healthy,
    },
    {
      id: 'demo-task-4',
      name: 'Weekly security audit',
      runtimeLabel: 'Codex CLI',
      enabled: 1,
      cron: '0 9 * * 1',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: now + 2 * 86400_000,
      lastRunAt: now - 5 * 86400_000,
      ...healthy,
    },
    {
      id: 'demo-task-5',
      name: 'Stripe failed-payment ping',
      runtimeLabel: 'Claude Code',
      enabled: 1,
      cron: '',
      webhookIntegrationId: 'stripe',
      queuedCount: 0,
      nextRunAt: null,
      lastRunAt: now - 5 * 3600_000,
      ...healthy,
    },
    {
      id: 'demo-task-6',
      name: 'Waitlist digest to Linear',
      runtimeLabel: 'Claude Code',
      enabled: 1,
      cron: '0 */6 * * *',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: now + 3 * 3600_000,
      lastRunAt: now - 3 * 3600_000,
      ...healthy,
    },
    {
      id: 'demo-task-7',
      name: 'Usage spend report',
      runtimeLabel: 'Codex CLI',
      enabled: 1,
      cron: '0 9 * * *',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: now + 10 * 3600_000,
      lastRunAt: now - 14 * 3600_000,
      ...healthy,
    },
    {
      id: 'demo-task-8',
      name: 'CI flake triage',
      runtimeLabel: 'Gemini CLI',
      enabled: 1,
      cron: '*/15 * * * *',
      webhookIntegrationId: '',
      queuedCount: 2,
      nextRunAt: now + 8 * 60_000,
      lastRunAt: now - 12 * 60_000,
      ...healthy,
    },
    {
      id: 'demo-task-9',
      name: 'Rebuild landing OG images',
      runtimeLabel: 'Claude Code',
      enabled: 0,
      cron: '0 18 * * *',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: null,
      lastRunAt: now - 3 * 86400_000,
      ...healthy,
    },
    {
      id: 'demo-task-10',
      name: 'Preview deploy smoke',
      runtimeLabel: 'Claude Code',
      enabled: 1,
      cron: '0 * * * *',
      webhookIntegrationId: '',
      queuedCount: 0,
      nextRunAt: now + 40 * 60_000,
      lastRunAt: now - 20 * 60_000,
      ...healthy,
    },
  ]
}
