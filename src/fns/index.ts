/**
 * Server functions — the RPC surface used by the React UI.
 *
 * Each handler lazily imports the server-only core module so that better-sqlite3,
 * node-cron and child_process never end up in the client bundle.
 */
import { createServerFn } from '@tanstack/react-start'
import type {
  CreateIntegrationInput,
  NotifierInput,
  PreviewCommandInput,
  RuntimeInput,
  TaskInput,
  UpdateIntegrationInput,
} from '../server/core'
import type { PlanProposal } from '../lib/planProposals'
import type { IntegrationProviderId } from '../lib/integrations/types'
import type { InstallIntegrationInput } from '../lib/integrations/install'
import type { CheckDef } from '../lib/checks'

export type { PlanProposal } from '../lib/planProposals'

export type {
  LocalDirEntry,
  ProjectRow,
  WorkspaceRow,
  ProjectWithMeta,
  WorkspaceWithMeta,
  IntegrationPublic,
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
  .validator((d: { taskId?: string; limit?: number; includeArchived?: boolean }) => d)
  .handler(async ({ data }) => (await core()).listRuns(data))

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

export const postMessage = createServerFn({ method: 'POST' })
  .validator(
    (d: { runId: string; prompt: string; model?: string; effort?: string; runtimeMode?: string }) =>
      d,
  )
  .handler(async ({ data }) => (await core()).postMessage(data))

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

export const commitChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; message: string; paths?: string[] }) => d)
  .handler(async ({ data }) => (await core()).commitChanges(data))

export const pushChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => d)
  .handler(async ({ data }) => (await core()).pushChanges(data))

export const discardChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; paths?: string[] }) => d)
  .handler(async ({ data }) => (await core()).discardChanges(data))

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
  .validator((d: { dir?: string }) => d)
  .handler(async ({ data }) => (await core()).listLocalDirectories(data.dir))

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
  .validator((d: { id: string; revealSecret?: boolean }) => d)
  .handler(
    async ({ data }) =>
      (await core()).getIntegrationPublic(data.id, Boolean(data.revealSecret)) ?? null,
  )

export const createIntegration = createServerFn({ method: 'POST' })
  .validator((d: CreateIntegrationInput) => d)
  .handler(async ({ data }) => (await core()).createIntegration(data))

export const updateIntegration = createServerFn({ method: 'POST' })
  .validator((d: UpdateIntegrationInput) => d)
  .handler(async ({ data }) => (await core()).updateIntegration(data))

export const rotateIntegrationSecret = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => (await core()).rotateIntegrationSecret(data.id))

export const removeIntegration = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    ;(await core()).deleteIntegration(data.id)
    return { ok: true }
  })

export const listWebhookDeliveries = createServerFn({ method: 'GET' })
  .validator((d: { integrationId?: string; limit?: number }) => d)
  .handler(async ({ data }) => {
    const c = await core()
    if (data.integrationId) {
      return c.listDeliveriesForIntegration(data.integrationId, data.limit ?? 30)
    }
    return c.listRecentDeliveries(data.limit ?? 50)
  })

export const getInstallContext = createServerFn({ method: 'GET' }).handler(async () =>
  (await core()).getInstallContext(),
)

export const installIntegration = createServerFn({ method: 'POST' })
  .validator((d: InstallIntegrationInput) => d)
  .handler(async ({ data }) => (await core()).installIntegration(data))

/** Soft type re-export for UI forms. */
export type { IntegrationProviderId }
export type { InstallIntegrationInput }

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
  .validator((d: { origin: string }) => d)
  .handler(async ({ data }) => (await core()).startCloudLogin(data.origin))

export const completeCloudLogin = createServerFn({ method: 'POST' })
  .validator((d: { code: string; state: string }) => d)
  .handler(async ({ data }) => {
    const c = await core()
    const session = await c.completeCloudLogin(data)
    await c.afterSignIn()
    return { email: session.email, userId: session.userId }
  })

export const skipCloudOnboarding = createServerFn({ method: 'POST' }).handler(async () =>
  (await core()).skipCloudOnboarding(),
)

export const signOutCloud = createServerFn({ method: 'POST' }).handler(async () => {
  await (await core()).signOutAndDisconnect()
  return { ok: true }
})

export const startJiraConnect = createServerFn({ method: 'POST' })
  .validator((d: { origin: string }) => d)
  .handler(async ({ data }) => (await core()).startJiraConnect(data.origin))

export const completeHostedJiraConnect = createServerFn({ method: 'POST' })
  .validator((d: { cloudConnectionId: string; siteUrl?: string; name?: string }) => d)
  .handler(async ({ data }) => (await core()).completeHostedJiraConnect(data))

export const ingestTestEvent = createServerFn({ method: 'POST' })
  .validator((d: { integrationId: string }) => d)
  .handler(async ({ data }) => (await core()).ingestTestEvent(data.integrationId))
