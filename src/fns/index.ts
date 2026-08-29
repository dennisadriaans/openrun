/**
 * Server functions — the RPC surface used by the React UI.
 *
 * Each handler lazily imports the server-only core module so that better-sqlite3,
 * node-cron and child_process never end up in the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'
import type {
  CreateIntegrationAutomationInput,
  CreateIntegrationInput,
  NotifierInput,
  PreviewCommandInput,
  RuntimeInput,
  TaskInput,
  UpdateIntegrationInput,
} from '../server/core'
import type { PlanProposal } from '../lib/planProposals'
import type { IntegrationProviderId, WebhookFilters } from '../lib/integrations/types'
import type { CheckDef } from '../lib/checks'
import type { McpServerConfig } from '../lib/mcp'

export type { PlanProposal } from '../lib/planProposals'

export type {
  LocalDirEntry,
  LocalPlace,
  ProjectRow,
  WorkspaceRow,
  ProjectWithMeta,
  WorkspaceWithMeta,
  IntegrationPublic,
  TaskWithMeta,
} from '../server/core'

const core = () => import('../server/core')

// --- Dashboard -------------------------------------------------------------

export const dashboard = createServerFn({ method: 'GET' }).handler(async () => {
  return (await core()).getDashboard()
})

// --- Runtimes --------------------------------------------------------------

export const listRuntimes = createServerFn({ method: 'GET' }).handler(async () => {
  const c = await core()
  return c.listRuntimes().map((r) => ({
    ...r,
    ...c.checkRuntimeInstalled(r.bin),
  }))
})

export const listPresetBins = createServerFn({ method: 'GET' }).handler(async () => {
  return (await core()).listPresetBinStatus()
})

export const saveRuntime = createServerFn({ method: 'POST' })
  .validator((d: RuntimeInput) => d)
  .handler(async ({ data }) => (await core()).upsertRuntime(data))

/**
 * Resolve the exact argv a runtime draft would spawn — no run row, no process.
 * POST because the Runtimes editor previews an unsaved template.
 */
export const previewCommand = createServerFn({ method: 'POST' })
  .validator((d: PreviewCommandInput) => d)
  .handler(async ({ data }) => (await core()).previewRuntimeCommand(data))

/** Same preview for a saved runtime, by id (tooling / non-UI callers). */
export const previewCommandForRuntime = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runtimeId: string
      workspaceId?: string
      model?: string
      effort?: string
      runtimeMode?: string
      isFollowUp?: boolean
    }) => d,
  )
  .handler(async ({ data }) => (await core()).previewRuntimeCommandById(data))

export const removeRuntime = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteRuntime(data.id)
    return { ok: true }
  })

// --- MCP servers -----------------------------------------------------------

export const getMcpConfig = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string }) => d)
  .handler(async ({ data }) => (await core()).getMcpConfig(data))

export const saveMcpServer = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runtimeId: string
      workspaceId?: string
      targetId: string
      server: McpServerConfig
      previousName?: string
    }) => d,
  )
  .handler(async ({ data }) => (await core()).saveMcpServerConfig(data))

export const removeMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { runtimeId: string; workspaceId?: string; targetId: string; name: string }) => d)
  .handler(async ({ data }) => (await core()).removeMcpServerConfig(data))

export const getSharedMcp = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getSharedMcpConfig(),
)

export const saveSharedMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { server: McpServerConfig; previousName?: string; force?: boolean }) => d)
  .handler(async ({ data }) => (await core()).saveSharedMcpServerConfig(data))

export const removeSharedMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { name: string; scope?: 'registry' | 'everywhere' }) => d)
  .handler(async ({ data }) => (await core()).removeSharedMcpServerConfig(data))

export const discoverMcpServers = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).discoverMcpServersConfig(),
)

export const importMcpServers = createServerFn({ method: 'POST' })
  .validator((d: { choices: { name: string; fromTargetId: string }[] }) => d)
  .handler(async ({ data }) => (await core()).importMcpServersConfig(data))

export const getMcpOAuthStatus = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getMcpOAuthStatus(),
)

export const startMcpOAuth = createServerFn({ method: 'POST' })
  .validator((d: { name: string; redirectUri: string }) => d)
  .handler(async ({ data }) => (await core()).startMcpOAuth(data))

export const disconnectMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { name: string }) => d)
  .handler(async ({ data }) => (await core()).disconnectMcpServer(data))

export const syncSharedMcp = createServerFn({ method: 'POST' })
  .validator((d: { force?: boolean }) => d)
  .handler(async ({ data }) => (await core()).syncSharedMcpConfig(data))

// --- Slash commands --------------------------------------------------------

export const listSlashCommands = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string; includeApp?: boolean }) => d)
  .handler(async ({ data }) => (await core()).listSlashCommandsFor(data))

// --- Plugins ---------------------------------------------------------------

export const listPlugins = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string }) => d)
  .handler(async ({ data }) => (await core()).listPluginsFor(data))

export const listInstalledPlugins = createServerFn({ method: 'GET' })
  .validator((d: { workspaceId?: string }) => d)
  .handler(async ({ data }) => (await core()).listInstalledPlugins(data))

// --- Tasks -----------------------------------------------------------------

export const listTasks = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listTasks(),
)

export const getTask = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).getTask(data.id) ?? null)

export const saveTask = createServerFn({ method: 'POST' })
  .validator((d: TaskInput) => d)
  .handler(async ({ data }) => (await core()).upsertTask(data))

export const saveTaskWebhook = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      taskId: string
      webhookIntegrationId?: string
      webhookEvents?: string[]
      webhookFilters?: WebhookFilters
    }) => d,
  )
  .handler(async ({ data }) => (await core()).updateTaskWebhook(data) ?? null)

export const toggleTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; enabled: boolean }) => d)
  .handler(async ({ data }) => (await core()).setTaskEnabled(data.id, data.enabled) ?? null)

export const removeTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteTask(data.id)
    return { ok: true }
  })

export const runTaskNow = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).runTaskNow(data.id))

export const isolateTaskWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).isolateTaskWorkspace(data.id))

export const restoreTaskWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).restoreTaskWorkspace(data.id))

export const clearTaskWorkspaceQuarantine = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).clearTaskWorkspaceQuarantine(data.id))

export const restoreWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { workspaceId: string }) => d)
  .handler(async ({ data }) => (await core()).restoreWorkspaceById(data.workspaceId))

export const runWorkspaceBaseline = createServerFn({ method: 'POST' })
  .validator((d: { workspaceId: string }) => d)
  .handler(async ({ data }) => (await core()).runWorkspaceBaseline(data.workspaceId))

export const listNativeSessions = createServerFn({ method: 'GET' })
  .validator(
    (d: {
      workspaceId: string
      kind?: 'claude' | 'codex' | 'grok' | 'antigravity'
      offset?: number
      limit?: number
    }) => d,
  )
  .handler(async ({ data }) => (await core()).listNativeSessions(data))

// --- Runs ------------------------------------------------------------------

export const listRuns = createServerFn({ method: 'GET' })
  .validator(
    (d: { taskId?: string; limit?: number; offset?: number; includeArchived?: boolean }) => d,
  )
  .handler(async ({ data }) => (await core()).listRuns(data))

export const countRuns = createServerFn({ method: 'GET' })
  .validator((d: { taskId?: string; includeArchived?: boolean }) => d)
  .handler(async ({ data }) => (await core()).countRuns(data))

export const listRunChecks = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).listRunChecks(data.runId))

export const rerunRunChecks = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).rerunRunChecks(data.runId))

export const getRun = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).getRun(data.id) ?? null)

export const cancelRun = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).cancelRun(data.id) ?? null)

export const markRunRead = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).markRunRead(data.id))

export const removeRun = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteRun(data.id)
    return { ok: true }
  })

export const getLatestRunForWorkspace = createServerFn({ method: 'GET' })
  .validator((d: { workspaceId: string }) => d)
  .handler(async ({ data }) => (await core()).getLatestRunForWorkspace(data.workspaceId))

export const startChat = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      workspaceId: string
      runtimeId: string
      prompt: string
      model?: string
      effort?: string
      runtimeMode?: string
      resumeSessionId?: string
      resumeSessionLabel?: string
    }) => d,
  )
  .handler(async ({ data }) => (await core()).startChat(data))

// --- Conversation ----------------------------------------------------------

export const getConversation = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).getConversation(data.runId))

export const getRunWorkspace = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).getRunWorkspace(data.runId))

export const getRunPullRequest = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).getRunPullRequest(data.runId))

export const postMessage = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runId: string
      prompt: string
      runtimeId?: string
      model?: string
      effort?: string
      runtimeMode?: string
      userMessageId?: string
      assistantMessageId?: string
      /** Interrupt the running turn instead of queueing behind it. */
      force?: boolean
    }) => d,
  )
  .handler(async ({ data }) => (await core()).postMessage(data))

/** Drop one follow-up waiting on the current turn. */
export const dequeueMessage = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).dequeueFollowUp(data))

/** Drop every follow-up waiting on a run. */
export const clearQueuedMessages = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).clearQueuedFollowUps(data.runId))

/** Deliver the next queued follow-up on a run that is no longer working. */
export const flushQueuedMessages = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).flushQueuedFollowUps(data.runId))

/**
 * Answer a pending tool-approval on a supervised run (allow/deny). The run
 * detail UI calls this from the approval prompt; unanswered requests auto-deny
 * on a timeout in the executor.
 */
export const answerApproval = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runId: string
      requestId: string
      /** ACP option the user picked; preferred over `decision`. */
      optionId?: string
      decision?: 'allow' | 'deny'
      message?: string
    }) => d,
  )
  .handler(async ({ data }) => (await core()).answerApproval(data))

// --- Git -------------------------------------------------------------------

export const getFileDiff = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; path: string }) => d)
  .handler(async ({ data }) => (await core()).getFileDiff(data))

// --- Workspace files -------------------------------------------------------

export const listWorkspaceFiles = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; dir?: string }) => d)
  .handler(async ({ data }) => (await core()).listWorkspaceFiles(data))

export const readWorkspaceFile = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; path: string }) => d)
  .handler(async ({ data }) => (await core()).readWorkspaceFile(data))

export const writeWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; content: string }) => d)
  .handler(async ({ data }) => (await core()).writeWorkspaceFile(data))

export const restoreWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; content: string }) => d)
  .handler(async ({ data }) => (await core()).restoreWorkspaceFile(data))

/** Upload a composer image; `data` is raw base64 without the data-URL prefix. */
export const saveAttachment = createServerFn({ method: 'POST' })
  .validator((d: { workspaceId: string; name: string; mimeType: string; data: string }) => d)
  .handler(async ({ data }) => (await core()).saveWorkspaceAttachment(data))

export const commitChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; message: string; paths?: string[] }) => d)
  .handler(async ({ data }) => (await core()).commitChanges(data))

export const pushChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).pushChanges(data))

export const discardChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; paths?: string[]; resetCommits?: boolean }) => d)
  .handler(async ({ data }) => (await core()).discardChanges(data))

export const discardHunk = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; hunkIndex: number }) => d)
  .handler(async ({ data }) => (await core()).discardHunk(data))

export const createBranch = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; name: string }) => d)
  .handler(async ({ data }) => (await core()).createBranch(data))

export const openPullRequest = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; title: string; body: string; base?: string }) => d)
  .handler(async ({ data }) => (await core()).openPullRequest(data))

// --- Planner ---------------------------------------------------------------

export const planObjective = createServerFn({ method: 'POST' })
  .validator((d: { objective: string; runtimeId: string; workspaceId: string }) => d)
  .handler(async ({ data }) => (await core()).planObjective(data))

export const installPlanProposal = createServerFn({ method: 'POST' })
  .validator(
    (d: { runtimeId: string; workspaceId: string; proposal: PlanProposal; enabled?: boolean }) => d,
  )
  .handler(async ({ data }) => (await core()).installPlanProposal(data))

export const createTasksFromPlan = createServerFn({ method: 'POST' })
  .validator(
    (d: { runtimeId: string; workspaceId: string; proposals: PlanProposal[]; enabled?: boolean }) =>
      d,
  )
  .handler(async ({ data }) => (await core()).createTasksFromPlan(data))

// --- Projects ----------------------------------------------------------------

export const listProjects = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listProjects(),
)

export const listLocalDirectories = createServerFn({ method: 'GET' })
  .validator((d: { dir?: string; showHidden?: boolean }) => d)
  .handler(async ({ data }) => (await core()).listLocalDirectories(data.dir, data.showHidden))

export const listLocalPlaces = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listLocalPlaces(),
)

export const createLocalFolder = createServerFn({ method: 'POST' })
  .validator((d: { parent?: string; name: string }) => d)
  .handler(async ({ data }) => (await core()).createLocalFolder(data))

export const addProject = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      mode: 'clone' | 'register'
      url?: string
      path?: string
      name?: string
      setupCommand?: string
    }) => d,
  )
  .handler(async ({ data }) => (await core()).addProject(data))

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      id: string
      name?: string
      setupCommand?: string
      defaultBranch?: string
      checks?: CheckDef[]
    }) => d,
  )
  .handler(async ({ data }) => (await core()).updateProject(data))

/** Checks Open Run would propose for this repo, from its package.json scripts. */
export const suggestProjectChecks = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).suggestProjectChecks(data.id))

export const removeProject = createServerFn({ method: 'POST' })
  .validator((d: { id: string; deleteFiles: boolean }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteProject(data.id, data.deleteFiles)
    return { ok: true }
  })

// --- Workspaces ----------------------------------------------------------------

export const listWorkspaces = createServerFn({ method: 'GET' })
  .validator((d: { projectId?: string }) => d)
  .handler(async ({ data }) => (await core()).listWorkspaces(data.projectId))

export const listProjectBranches = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => d)
  .handler(async ({ data }) => (await core()).listProjectBranches(data.projectId))

export const createWorkspace = createServerFn({ method: 'POST' })
  .validator(
    (d: { projectId: string; branch: string; fromBranch?: string; useExistingBranch?: boolean }) =>
      d,
  )
  .handler(async ({ data }) => (await core()).createWorkspace(data))

export const retryWorkspaceSetup = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).runSetup(data.id))

export const archiveWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string; force: boolean }) => d)
  .handler(async ({ data }) => (await core()).archiveWorkspace(data.id, data.force))

// --- Usage -----------------------------------------------------------------

export const usageReport = createServerFn({ method: 'GET' })
  .validator((d: { range?: string }) => d)
  .handler(async ({ data }) => (await core()).getUsageReport(data))

export const usagePressure = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getUsagePressure(),
)

// --- Notifications ---------------------------------------------------------

export const listNotifiers = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listNotifiers(),
)

export const saveNotifier = createServerFn({ method: 'POST' })
  .validator((d: NotifierInput) => d)
  .handler(async ({ data }) => (await core()).upsertNotifier(data))

export const removeNotifier = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteNotifier(data.id)
    return { ok: true }
  })

export const testNotifier = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).testNotifier(data.id))

export const listNotificationDeliveries = createServerFn({ method: 'GET' })
  .validator((d: { notifierId?: string; limit?: number }) => d)
  .handler(async ({ data }) => (await core()).listNotificationDeliveries(data))

// --- Integrations (webhooks) -----------------------------------------------

export const listIntegrationProviders = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listProviderCatalog(),
)

export const listIntegrations = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listIntegrations(),
)

export const getIntegration = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).getIntegrationPublic(data.id) ?? null)

export const createIntegration = createServerFn({ method: 'POST' })
  .validator((d: CreateIntegrationInput) => d)
  .handler(async ({ data }) => (await core()).createIntegration(data))

export const updateIntegration = createServerFn({ method: 'POST' })
  .validator((d: UpdateIntegrationInput) => d)
  .handler(async ({ data }) => (await core()).updateIntegration(data))

export const listWebhookDeliveries = createServerFn({ method: 'GET' })
  .validator((d: { integrationId?: string; limit?: number }) => d)
  .handler(async ({ data }) => {
    const c = await core()
    if (data.integrationId) {
      return c.listDeliveriesForIntegration(data.integrationId, data.limit ?? 30)
    }
    return c.listRecentDeliveries(data.limit ?? 50)
  })

export const getAutomationSetupContext = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getAutomationSetupContext(),
)

/** Bind a connected integration to a workspace + runtime so deliveries run. */
export const createIntegrationAutomation = createServerFn({ method: 'POST' })
  .validator((d: CreateIntegrationAutomationInput) => d)
  .handler(async ({ data }) => (await core()).createIntegrationAutomation(data))

/** Soft type re-export for UI forms. */
export type { IntegrationProviderId }

// --- Mobile devices --------------------------------------------------------

export const mobileStatus = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).mobileStatus(),
)

export const createPairingCode = createServerFn({ method: 'POST' }).handler(async () =>
  (await core()).createPairingCode(),
)

export const cancelPairing = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).cancelPairing(data.id)
    return { ok: true }
  })

export const revokeDevice = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).revokeDevice(data.id)
    return { ok: true }
  })

export const removeDevice = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteDevice(data.id)
    return { ok: true }
  })

// --- Cloud -----------------------------------------------------------------

export const cloudStatus = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getCloudStatus(),
)

export const startCloudLogin = createServerFn({ method: 'POST' })
  .validator((d: { origin: string; next?: string }) => d)
  .handler(async ({ data }) => (await core()).startCloudLogin(data.origin, data.next))

export const completeCloudLogin = createServerFn({ method: 'POST' })
  .validator((d: { code: string; state: string }) => d)
  .handler(async ({ data }) => {
    const c = await core()
    const session = await c.completeCloudLogin(data)
    await c.afterSignIn()
    return { email: session.email, userId: session.userId, next: session.next }
  })

/** Which providers this control plane can connect. Public — no session needed. */
export const cloudProviders = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listCloudProviders(),
)

export const skipCloudOnboarding = createServerFn({ method: 'POST' }).handler(async () =>
  (await core()).skipCloudOnboarding(),
)

export const signOutCloud = createServerFn({ method: 'POST' }).handler(async () => {
  await (await core()).signOutAndDisconnect()
  return { ok: true }
})

export const startHostedConnect = createServerFn({ method: 'POST' })
  .validator((d: { provider: string; origin: string }) => d)
  .handler(async ({ data }) => (await core()).startHostedConnect(data))

export const completeHostedConnect = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      provider: string
      cloudConnectionId: string
      state?: string
      siteUrl?: string
      accountName?: string
    }) => d,
  )
  .handler(async ({ data }) => (await core()).completeHostedConnect(data))

export const listHostedConnections = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).listHostedConnections(),
)

export const disconnectHostedIntegration = createServerFn({ method: 'POST' })
  .validator((d: { integrationId: string }) => d)
  .handler(async ({ data }) => (await core()).disconnectHostedIntegration(data.integrationId))

export const ingestTestEvent = createServerFn({ method: 'POST' })
  .validator((d: { integrationId: string }) => d)
  .handler(async ({ data }) => (await core()).ingestTestEvent(data.integrationId))
