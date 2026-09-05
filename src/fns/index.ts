/**
 * GENERATED — do not edit.
 *
 * Every operation here comes from `src/contract/operations.ts`. Change the
 * descriptor and run `pnpm contract:generate`; editing this file by hand is
 * undone by the next run and fails the `contract drift` check in CI.
 */
import { createServerFn } from '@tanstack/react-start'
import { optionalShape, shape } from '../lib/validate.ts'
import type { CheckDef } from '../lib/checks'
import type { WebhookFilters } from '../lib/integrations/types'
import type { McpServerConfig } from '../lib/mcp'
import type { PlanProposal } from '../lib/planProposals'
import type {
  CreateIntegrationAutomationInput,
  CreateIntegrationInput,
  NotifierInput,
  PreviewCommandInput,
  RuntimeInput,
  TaskInput,
  UpdateIntegrationInput,
} from '../server/core'

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

/**
 * The dispatcher is reached lazily, exactly as `server/core` was before it.
 * That laziness is what keeps `better-sqlite3`, `node-cron` and
 * `child_process` out of the client bundle — a top-level static import of
 * anything under `server/` here breaks the client build.
 */
const dispatcher = () => import('../server/contract/dispatch')

/**
 * Turn a dispatch result back into the throw-or-value contract React Query
 * expects. A domain refusal arrives as `ok: false` carrying the message the
 * gate would have shown, and becomes an `Error` with those exact words.
 */
async function run(id: string, data?: unknown): Promise<unknown> {
  const { dispatch } = await dispatcher()
  const result = await dispatch(id, data, 'web')
  if (!result.ok) throw new Error(result.error ?? 'Request failed')
  return result.body
}

/**
 * Return types, recovered from the facade.
 *
 * Dispatch is one generic function, so it cannot carry per-operation return
 * types on its own. `typeof import(...)` is erased at compile time — no
 * runtime import, nothing added to the client bundle — so the generated
 * handlers can name `core.ts`'s own inferred types and every caller in
 * `lib/queries.ts` keeps the types it had before the contract existed.
 */
type Core = typeof import('../server/core')
type CoreResult<K extends keyof Core> = Core[K] extends (...args: never[]) => infer R
  ? Awaited<R>
  : never
/** Handlers that coerced `undefined` to `null` keep doing so. */
type Nullable<T> = Exclude<T, undefined> | null

// --- cloud -------------------------------------------------------------------

export const cloudStatus = createServerFn({ method: 'GET' }).handler(
  async () => run('cloud.status') as Promise<CoreResult<'getCloudStatus'>>,
)

export const startCloudLogin = createServerFn({ method: 'POST' })
  .validator((d: { origin: string; next?: string }) =>
    shape(d, { origin: 'string', next: 'string?' }),
  )
  .handler(
    async ({ data }) => run('cloud.startLogin', data) as Promise<CoreResult<'startCloudLogin'>>,
  )

export const completeCloudLogin = createServerFn({ method: 'POST' })
  .validator((d: { code: string; state: string }) => shape(d, { code: 'string', state: 'string' }))
  .handler(
    async ({ data }) =>
      run('cloud.completeLogin', data) as Promise<CoreResult<'completeCloudLoginAndFinish'>>,
  )

/** Which providers this control plane can connect. Public — no session needed. */
export const cloudProviders = createServerFn({ method: 'GET' }).handler(
  async () => run('cloud.providers') as Promise<CoreResult<'listCloudProviders'>>,
)

export const skipCloudOnboarding = createServerFn({ method: 'POST' }).handler(
  async () => run('cloud.skipOnboarding') as Promise<CoreResult<'skipCloudOnboarding'>>,
)

export const signOutCloud = createServerFn({ method: 'POST' }).handler(
  async () => run('cloud.signOut') as Promise<{ ok: true }>,
)

export const startHostedConnect = createServerFn({ method: 'POST' })
  .validator((d: { provider: string; origin: string }) =>
    shape(d, { provider: 'string', origin: 'string' }),
  )
  .handler(
    async ({ data }) =>
      run('cloud.startHostedConnect', data) as Promise<CoreResult<'startHostedConnect'>>,
  )

export const completeHostedConnect = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      provider: string
      cloudConnectionId: string
      state?: string
      siteUrl?: string
      accountName?: string
    }) =>
      shape(d, {
        provider: 'string',
        cloudConnectionId: 'string',
        state: 'string?',
        siteUrl: 'string?',
        accountName: 'string?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('cloud.completeHostedConnect', data) as Promise<CoreResult<'completeHostedConnect'>>,
  )

export const listHostedConnections = createServerFn({ method: 'GET' }).handler(
  async () => run('cloud.listHostedConnections') as Promise<CoreResult<'listHostedConnections'>>,
)

// --- code --------------------------------------------------------------------

/** Tokenize a snippet with the app's own highlighter; answers class names, not colours. */
export const highlightCodeBlock = createServerFn({ method: 'POST' })
  .validator((d: { code: string; language?: string; path?: string }) =>
    shape(d, { code: 'string', language: 'string?', path: 'string?' }),
  )
  .handler(
    async ({ data }) => run('code.highlight', data) as Promise<CoreResult<'highlightCodeBlock'>>,
  )

// --- dashboard ---------------------------------------------------------------

export const dashboard = createServerFn({ method: 'GET' }).handler(
  async () => run('dashboard.dashboard') as Promise<CoreResult<'getDashboard'>>,
)

// --- devices -----------------------------------------------------------------

export const mobileStatus = createServerFn({ method: 'GET' }).handler(
  async () => run('devices.mobileStatus') as Promise<CoreResult<'mobileStatus'>>,
)

export const createPairingCode = createServerFn({ method: 'POST' }).handler(
  async () => run('devices.createPairingCode') as Promise<CoreResult<'createPairingCode'>>,
)

export const cancelPairing = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('devices.cancelPairing', data) as Promise<{ ok: true }>)

export const revokeDevice = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('devices.revoke', data) as Promise<{ ok: true }>)

export const removeDevice = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('devices.remove', data) as Promise<{ ok: true }>)

// --- files -------------------------------------------------------------------

export const listWorkspaceFiles = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; dir?: string }) => shape(d, { runId: 'string', dir: 'string?' }))
  .handler(
    async ({ data }) =>
      run('files.listWorkspace', data) as Promise<CoreResult<'listWorkspaceFiles'>>,
  )

export const readWorkspaceFile = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; path: string }) => shape(d, { runId: 'string', path: 'string' }))
  .handler(
    async ({ data }) =>
      run('files.readWorkspace', data) as Promise<CoreResult<'readWorkspaceFile'>>,
  )

export const writeWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; content: string }) =>
    shape(d, { runId: 'string', path: 'string', content: 'string' }),
  )
  .handler(
    async ({ data }) =>
      run('files.writeWorkspace', data) as Promise<CoreResult<'writeWorkspaceFile'>>,
  )

export const restoreWorkspaceFile = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; content: string }) =>
    shape(d, { runId: 'string', path: 'string', content: 'string' }),
  )
  .handler(
    async ({ data }) =>
      run('files.restoreWorkspace', data) as Promise<CoreResult<'restoreWorkspaceFile'>>,
  )

/** Upload a composer image; `data` is raw base64 without the data-URL prefix. */
export const saveAttachment = createServerFn({ method: 'POST' })
  .validator(
    (d: { workspaceId: string; runId?: string; name: string; mimeType: string; data: string }) =>
      shape(d, {
        workspaceId: 'string',
        runId: 'string?',
        name: 'string',
        mimeType: 'string',
        data: 'string',
      }),
  )
  .handler(
    async ({ data }) =>
      run('files.saveAttachment', data) as Promise<CoreResult<'saveWorkspaceAttachment'>>,
  )

// --- git ---------------------------------------------------------------------

export const getFileDiff = createServerFn({ method: 'GET' })
  .validator((d: { runId: string; path: string; whole?: boolean }) =>
    shape(d, { runId: 'string', path: 'string', whole: 'boolean?' }),
  )
  .handler(async ({ data }) => run('git.getFileDiff', data) as Promise<CoreResult<'getFileDiff'>>)

export const commitChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; message: string; paths?: string[] }) =>
    shape(d, { runId: 'string', message: 'string', paths: 'string[]?' }),
  )
  .handler(
    async ({ data }) => run('git.commitChanges', data) as Promise<CoreResult<'commitChanges'>>,
  )

export const pushChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(async ({ data }) => run('git.pushChanges', data) as Promise<CoreResult<'pushChanges'>>)

export const discardChanges = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; paths?: string[]; resetCommits?: boolean }) =>
    shape(d, { runId: 'string', paths: 'string[]?', resetCommits: 'boolean?' }),
  )
  .handler(
    async ({ data }) => run('git.discardChanges', data) as Promise<CoreResult<'discardChanges'>>,
  )

export const discardHunk = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; path: string; hunkIndex: number }) =>
    shape(d, { runId: 'string', path: 'string', hunkIndex: 'number' }),
  )
  .handler(async ({ data }) => run('git.discardHunk', data) as Promise<CoreResult<'discardHunk'>>)

export const createBranch = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; name: string }) => shape(d, { runId: 'string', name: 'string' }))
  .handler(async ({ data }) => run('git.createBranch', data) as Promise<CoreResult<'createBranch'>>)

export const openPullRequest = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; title: string; body: string; base?: string }) =>
    shape(d, { runId: 'string', title: 'string', body: 'string', base: 'string?' }),
  )
  .handler(
    async ({ data }) => run('git.openPullRequest', data) as Promise<CoreResult<'openPullRequest'>>,
  )

export const shipRun = createServerFn({ method: 'POST' })
  .validator((d: { runId: string; base?: string; skipPlan?: boolean }) =>
    shape(d, { runId: 'string', base: 'string?', skipPlan: 'boolean?' }),
  )
  .handler(async ({ data }) => run('git.shipRun', data) as Promise<CoreResult<'shipRun'>>)

export const listProjectBranches = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => shape(d, { projectId: 'string' }))
  .handler(
    async ({ data }) =>
      run('git.listProjectBranches', data) as Promise<CoreResult<'listProjectBranches'>>,
  )

// --- integrations ------------------------------------------------------------

export const listIntegrationProviders = createServerFn({ method: 'GET' }).handler(
  async () => run('integrations.listProviders') as Promise<CoreResult<'listProviderCatalog'>>,
)

export const listIntegrations = createServerFn({ method: 'GET' }).handler(
  async () => run('integrations.list') as Promise<CoreResult<'listIntegrations'>>,
)

export const getIntegration = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('integrations.get', data) as Promise<Nullable<CoreResult<'getIntegrationPublic'>>>,
  )

export const createIntegration = createServerFn({ method: 'POST' })
  .validator((d: CreateIntegrationInput) => shape(d, { provider: 'string' }))
  .handler(
    async ({ data }) =>
      run('integrations.create', data) as Promise<CoreResult<'createIntegration'>>,
  )

export const updateIntegration = createServerFn({ method: 'POST' })
  .validator((d: UpdateIntegrationInput) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('integrations.update', data) as Promise<CoreResult<'updateIntegration'>>,
  )

export const listWebhookDeliveries = createServerFn({ method: 'GET' })
  .validator((d: { integrationId?: string; limit?: number }) =>
    optionalShape(d, { integrationId: 'string?', limit: 'number?' }),
  )
  .handler(
    async ({ data }) =>
      run('integrations.listWebhookDeliveries', data) as Promise<
        CoreResult<'listWebhookDeliveries'>
      >,
  )

export const getAutomationSetupContext = createServerFn({ method: 'GET' }).handler(
  async () =>
    run('integrations.getAutomationSetupContext') as Promise<
      CoreResult<'getAutomationSetupContext'>
    >,
)

/** Bind a connected integration to a workspace + runtime so deliveries run. */
export const createIntegrationAutomation = createServerFn({ method: 'POST' })
  .validator((d: CreateIntegrationAutomationInput) =>
    shape(d, {
      integrationId: 'string',
      workspaceId: 'string',
      runtimeId: 'string',
      trigger: 'object?',
      events: 'string[]?',
      name: 'string?',
      prompt: 'string?',
      enabled: 'boolean?',
    }),
  )
  .handler(
    async ({ data }) =>
      run('integrations.createAutomation', data) as Promise<
        CoreResult<'createIntegrationAutomation'>
      >,
  )

export const disconnectHostedIntegration = createServerFn({ method: 'POST' })
  .validator((d: { integrationId: string }) => shape(d, { integrationId: 'string' }))
  .handler(
    async ({ data }) =>
      run('integrations.disconnectHosted', data) as Promise<
        CoreResult<'disconnectHostedIntegration'>
      >,
  )

export const ingestTestEvent = createServerFn({ method: 'POST' })
  .validator((d: { integrationId: string }) => shape(d, { integrationId: 'string' }))
  .handler(
    async ({ data }) =>
      run('integrations.ingestTestEvent', data) as Promise<CoreResult<'ingestTestEvent'>>,
  )

// --- mcp ---------------------------------------------------------------------

export const getMcpConfig = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string }) =>
    shape(d, { runtimeId: 'string', workspaceId: 'string?' }),
  )
  .handler(async ({ data }) => run('mcp.getConfig', data) as Promise<CoreResult<'getMcpConfig'>>)

export const saveMcpServer = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runtimeId: string
      workspaceId?: string
      targetId: string
      server: McpServerConfig
      previousName?: string
    }) =>
      shape(d, {
        runtimeId: 'string',
        workspaceId: 'string?',
        targetId: 'string',
        server: 'object',
        previousName: 'string?',
      }),
  )
  .handler(
    async ({ data }) => run('mcp.saveServer', data) as Promise<CoreResult<'saveMcpServerConfig'>>,
  )

export const removeMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { runtimeId: string; workspaceId?: string; targetId: string; name: string }) =>
    shape(d, { runtimeId: 'string', workspaceId: 'string?', targetId: 'string', name: 'string' }),
  )
  .handler(
    async ({ data }) =>
      run('mcp.removeServer', data) as Promise<CoreResult<'removeMcpServerConfig'>>,
  )

export const getSharedMcp = createServerFn({ method: 'GET' }).handler(
  async () => run('mcp.getShared') as Promise<CoreResult<'getSharedMcpConfig'>>,
)

export const saveSharedMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { server: McpServerConfig; previousName?: string; force?: boolean }) =>
    shape(d, { server: 'object', previousName: 'string?', force: 'boolean?' }),
  )
  .handler(
    async ({ data }) =>
      run('mcp.saveSharedServer', data) as Promise<CoreResult<'saveSharedMcpServerConfig'>>,
  )

export const removeSharedMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { name: string; scope?: 'registry' | 'everywhere' }) =>
    shape(d, { name: 'string', scope: 'string?' }),
  )
  .handler(
    async ({ data }) =>
      run('mcp.removeSharedServer', data) as Promise<CoreResult<'removeSharedMcpServerConfig'>>,
  )

export const discoverMcpServers = createServerFn({ method: 'GET' }).handler(
  async () => run('mcp.discoverServers') as Promise<CoreResult<'discoverMcpServersConfig'>>,
)

export const importMcpServers = createServerFn({ method: 'POST' })
  .validator((d: { choices: { name: string; fromTargetId: string }[] }) =>
    shape(d, { choices: 'array' }),
  )
  .handler(
    async ({ data }) =>
      run('mcp.importServers', data) as Promise<CoreResult<'importMcpServersConfig'>>,
  )

export const getMcpOAuthStatus = createServerFn({ method: 'GET' }).handler(
  async () => run('mcp.getOAuthStatus') as Promise<CoreResult<'getMcpOAuthStatus'>>,
)

export const startMcpOAuth = createServerFn({ method: 'POST' })
  .validator((d: { name: string; redirectUri: string }) =>
    shape(d, { name: 'string', redirectUri: 'string' }),
  )
  .handler(async ({ data }) => run('mcp.startOAuth', data) as Promise<CoreResult<'startMcpOAuth'>>)

export const disconnectMcpServer = createServerFn({ method: 'POST' })
  .validator((d: { name: string }) => shape(d, { name: 'string' }))
  .handler(
    async ({ data }) =>
      run('mcp.disconnectServer', data) as Promise<CoreResult<'disconnectMcpServer'>>,
  )

export const syncSharedMcp = createServerFn({ method: 'POST' })
  .validator((d: { force?: boolean }) => optionalShape(d, { force: 'boolean?' }))
  .handler(
    async ({ data }) => run('mcp.syncShared', data) as Promise<CoreResult<'syncSharedMcpConfig'>>,
  )

// --- notifications -----------------------------------------------------------

export const listNotifiers = createServerFn({ method: 'GET' }).handler(
  async () => run('notifications.listNotifiers') as Promise<CoreResult<'listNotifiers'>>,
)

export const saveNotifier = createServerFn({ method: 'POST' })
  .validator((d: NotifierInput) =>
    shape(d, { kind: 'string', name: 'string', target: 'string?', enabled: 'boolean' }),
  )
  .handler(
    async ({ data }) =>
      run('notifications.saveNotifier', data) as Promise<CoreResult<'upsertNotifier'>>,
  )

export const removeNotifier = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('notifications.removeNotifier', data) as Promise<{ ok: true }>)

export const testNotifier = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('notifications.testNotifier', data) as Promise<CoreResult<'testNotifier'>>,
  )

export const listNotificationDeliveries = createServerFn({ method: 'GET' })
  .validator((d: { notifierId?: string; limit?: number }) =>
    optionalShape(d, { notifierId: 'string?', limit: 'number?' }),
  )
  .handler(
    async ({ data }) =>
      run('notifications.listDeliveries', data) as Promise<
        CoreResult<'listNotificationDeliveries'>
      >,
  )

// --- planner -----------------------------------------------------------------

export const planObjective = createServerFn({ method: 'POST' })
  .validator((d: { objective: string; runtimeId: string; workspaceId: string }) =>
    shape(d, { objective: 'string', runtimeId: 'string', workspaceId: 'string' }),
  )
  .handler(
    async ({ data }) => run('planner.planObjective', data) as Promise<CoreResult<'planObjective'>>,
  )

export const installPlanProposal = createServerFn({ method: 'POST' })
  .validator(
    (d: { runtimeId: string; workspaceId: string; proposal: PlanProposal; enabled?: boolean }) =>
      shape(d, {
        runtimeId: 'string',
        workspaceId: 'string',
        proposal: 'object',
        enabled: 'boolean?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('planner.installPlanProposal', data) as Promise<CoreResult<'installPlanProposal'>>,
  )

// --- plugins -----------------------------------------------------------------

export const listPlugins = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string }) =>
    shape(d, { runtimeId: 'string', workspaceId: 'string?' }),
  )
  .handler(async ({ data }) => run('plugins.list', data) as Promise<CoreResult<'listPluginsFor'>>)

export const listInstalledPlugins = createServerFn({ method: 'GET' })
  .validator((d: { workspaceId?: string }) => optionalShape(d, { workspaceId: 'string?' }))
  .handler(
    async ({ data }) =>
      run('plugins.listInstalled', data) as Promise<CoreResult<'listInstalledPlugins'>>,
  )

// --- projects ----------------------------------------------------------------

export const listProjects = createServerFn({ method: 'GET' }).handler(
  async () => run('projects.list') as Promise<CoreResult<'listProjects'>>,
)

export const listLocalDirectories = createServerFn({ method: 'GET' })
  .validator((d: { dir?: string; showHidden?: boolean }) =>
    optionalShape(d, { dir: 'string?', showHidden: 'boolean?' }),
  )
  .handler(
    async ({ data }) =>
      run('projects.listLocalDirectories', data) as Promise<CoreResult<'listLocalDirectories'>>,
  )

export const listLocalPlaces = createServerFn({ method: 'GET' }).handler(
  async () => run('projects.listLocalPlaces') as Promise<CoreResult<'listLocalPlaces'>>,
)

export const createLocalFolder = createServerFn({ method: 'POST' })
  .validator((d: { parent?: string; name: string }) =>
    shape(d, { parent: 'string?', name: 'string' }),
  )
  .handler(
    async ({ data }) =>
      run('projects.createLocalFolder', data) as Promise<CoreResult<'createLocalFolder'>>,
  )

export const addProject = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      mode: 'clone' | 'register'
      url?: string
      path?: string
      name?: string
      setupCommand?: string
    }) =>
      shape(d, {
        mode: 'string',
        url: 'string?',
        path: 'string?',
        name: 'string?',
        setupCommand: 'string?',
      }),
  )
  .handler(async ({ data }) => run('projects.add', data) as Promise<CoreResult<'addProject'>>)

export const updateProject = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      id: string
      name?: string
      setupCommand?: string
      defaultBranch?: string
      checks?: CheckDef[]
    }) =>
      shape(d, {
        id: 'string',
        name: 'string?',
        setupCommand: 'string?',
        defaultBranch: 'string?',
        checks: 'array?',
      }),
  )
  .handler(async ({ data }) => run('projects.update', data) as Promise<CoreResult<'updateProject'>>)

/** Checks Open Run would propose for this repo, from its package.json scripts. */
export const suggestProjectChecks = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('projects.suggestChecks', data) as Promise<CoreResult<'suggestProjectChecks'>>,
  )

export const removeProject = createServerFn({ method: 'POST' })
  .validator((d: { id: string; deleteFiles: boolean }) =>
    shape(d, { id: 'string', deleteFiles: 'boolean' }),
  )
  .handler(async ({ data }) => run('projects.remove', data) as Promise<{ ok: true }>)

// --- runs --------------------------------------------------------------------

export const listNativeSessions = createServerFn({ method: 'GET' })
  .validator(
    (d: {
      workspaceId?: string
      allWorkspaces?: boolean
      kind?: 'claude' | 'codex' | 'grok' | 'antigravity'
      offset?: number
      limit?: number
    }) =>
      shape(d, {
        workspaceId: 'string?',
        allWorkspaces: 'boolean?',
        kind: 'string?',
        offset: 'number?',
        limit: 'number?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('runs.listNativeSessions', data) as Promise<CoreResult<'listNativeSessions'>>,
  )

export const listRuns = createServerFn({ method: 'GET' })
  .validator((d: { taskId?: string; limit?: number; offset?: number; includeArchived?: boolean }) =>
    optionalShape(d, {
      taskId: 'string?',
      limit: 'number?',
      offset: 'number?',
      includeArchived: 'boolean?',
    }),
  )
  .handler(async ({ data }) => run('runs.list', data) as Promise<CoreResult<'listRuns'>>)

export const listConversationNavigationRuns = createServerFn({ method: 'GET' }).handler(
  async () =>
    run('runs.listConversationNavigation') as Promise<CoreResult<'listConversationNavigationRuns'>>,
)

export const countRuns = createServerFn({ method: 'GET' })
  .validator((d: { taskId?: string; includeArchived?: boolean }) =>
    optionalShape(d, { taskId: 'string?', includeArchived: 'boolean?' }),
  )
  .handler(async ({ data }) => run('runs.count', data) as Promise<CoreResult<'countRuns'>>)

export const listRunChecks = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(async ({ data }) => run('runs.listChecks', data) as Promise<CoreResult<'listRunChecks'>>)

export const rerunRunChecks = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) => run('runs.reRunChecks', data) as Promise<CoreResult<'rerunRunChecks'>>,
  )

export const getRun = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('runs.get', data) as Promise<Nullable<CoreResult<'getRun'>>>)

export const cancelRun = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) => run('runs.cancel', data) as Promise<Nullable<CoreResult<'cancelRun'>>>,
  )

export const markRunRead = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('runs.markRead', data) as Promise<CoreResult<'markRunRead'>>)

export const removeRun = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('runs.remove', data) as Promise<{ ok: true }>)

export const deleteRuns = createServerFn({ method: 'POST' })
  .validator((d: { ids: string[] }) => shape(d, { ids: 'string[]' }))
  .handler(async ({ data }) => run('runs.delete', data) as Promise<{ ok: true }>)

export const getLatestRunForWorkspace = createServerFn({ method: 'GET' })
  .validator((d: { workspaceId: string }) => shape(d, { workspaceId: 'string' }))
  .handler(
    async ({ data }) =>
      run('runs.getLatestForWorkspace', data) as Promise<CoreResult<'getLatestRunForWorkspace'>>,
  )

export const getLatestRunForProject = createServerFn({ method: 'GET' })
  .validator((d: { projectId: string }) => shape(d, { projectId: 'string' }))
  .handler(
    async ({ data }) =>
      run('runs.getLatestForProject', data) as Promise<CoreResult<'getLatestRunForProject'>>,
  )

export const startRunOptions = createServerFn({ method: 'GET' }).handler(
  async () => run('runs.startOptions') as Promise<CoreResult<'startRunOptions'>>,
)

export const repeatRun = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(async ({ data }) => run('runs.repeat', data) as Promise<CoreResult<'repeatRun'>>)

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
    }) =>
      shape(d, {
        workspaceId: 'string',
        runtimeId: 'string',
        prompt: 'string',
        model: 'string?',
        effort: 'string?',
        runtimeMode: 'string?',
        resumeSessionId: 'string?',
        resumeSessionLabel: 'string?',
      }),
  )
  .handler(async ({ data }) => run('runs.startChat', data) as Promise<CoreResult<'startChat'>>)

export const openNativeChat = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      workspaceId: string
      runtimeId: string
      sessionId: string
      sessionLabel?: string
      model?: string
      effort?: string
      runtimeMode?: string
    }) =>
      shape(d, {
        workspaceId: 'string',
        runtimeId: 'string',
        sessionId: 'string',
        sessionLabel: 'string?',
        model: 'string?',
        effort: 'string?',
        runtimeMode: 'string?',
      }),
  )
  .handler(
    async ({ data }) => run('runs.openNativeChat', data) as Promise<CoreResult<'openNativeChat'>>,
  )

export const getConversation = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) => run('runs.getConversation', data) as Promise<CoreResult<'getConversation'>>,
  )

export const getRunWorkspace = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) => run('runs.getWorkspace', data) as Promise<CoreResult<'getRunWorkspace'>>,
  )

export const getRunPullRequest = createServerFn({ method: 'GET' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) =>
      run('runs.getPullRequest', data) as Promise<CoreResult<'getRunPullRequest'>>,
  )

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
      force?: boolean
    }) =>
      shape(d, {
        runId: 'string',
        prompt: 'string',
        runtimeId: 'string?',
        model: 'string?',
        effort: 'string?',
        runtimeMode: 'string?',
        userMessageId: 'string?',
        assistantMessageId: 'string?',
        force: 'boolean?',
      }),
  )
  .handler(async ({ data }) => run('runs.postMessage', data) as Promise<CoreResult<'postMessage'>>)

/** Drop one follow-up waiting on the current turn. */
export const dequeueMessage = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) => run('runs.dequeueMessage', data) as Promise<CoreResult<'dequeueFollowUp'>>,
  )

/** Drop every follow-up waiting on a run. */
export const clearQueuedMessages = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) =>
      run('runs.clearQueuedMessages', data) as Promise<CoreResult<'clearQueuedFollowUps'>>,
  )

/** Deliver the next queued follow-up on a run that is no longer working. */
export const flushQueuedMessages = createServerFn({ method: 'POST' })
  .validator((d: { runId: string }) => shape(d, { runId: 'string' }))
  .handler(
    async ({ data }) =>
      run('runs.flushQueuedMessages', data) as Promise<CoreResult<'flushQueuedFollowUps'>>,
  )

/** Answer a pending tool-approval on a supervised run (allow/deny). The run detail UI calls this from the approval prompt; unanswered requests auto-deny on a timeout in the executor. */
export const answerApproval = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      runId: string
      requestId: string
      optionId?: string
      decision?: 'allow' | 'deny'
      message?: string
    }) =>
      shape(d, {
        runId: 'string',
        requestId: 'string',
        optionId: 'string?',
        decision: 'string?',
        message: 'string?',
      }),
  )
  .handler(
    async ({ data }) => run('runs.answerApproval', data) as Promise<CoreResult<'answerApproval'>>,
  )

// --- runtimes ----------------------------------------------------------------

export const listRuntimes = createServerFn({ method: 'GET' }).handler(
  async () => run('runtimes.list') as Promise<CoreResult<'listRuntimesWithStatus'>>,
)

export const listPresetBins = createServerFn({ method: 'GET' }).handler(
  async () => run('runtimes.listPresetBins') as Promise<CoreResult<'listPresetBinStatus'>>,
)

export const saveRuntime = createServerFn({ method: 'POST' })
  .validator((d: RuntimeInput) => optionalShape(d, { label: 'string?', bin: 'string?' }))
  .handler(async ({ data }) => run('runtimes.save', data) as Promise<CoreResult<'upsertRuntime'>>)

/** Resolve the exact argv a runtime draft would spawn — no run row, no process. POST because the Runtimes editor previews an unsaved template. */
export const previewCommand = createServerFn({ method: 'POST' })
  .validator((d: PreviewCommandInput) => optionalShape(d, { runtimeId: 'string?', bin: 'string?' }))
  .handler(
    async ({ data }) =>
      run('runtimes.previewCommand', data) as Promise<CoreResult<'previewRuntimeCommand'>>,
  )

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
    }) =>
      shape(d, {
        runtimeId: 'string',
        workspaceId: 'string?',
        model: 'string?',
        effort: 'string?',
        runtimeMode: 'string?',
        isFollowUp: 'boolean?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('runtimes.previewCommandFor', data) as Promise<CoreResult<'previewRuntimeCommandById'>>,
  )

export const removeRuntime = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('runtimes.remove', data) as Promise<{ ok: true }>)

// --- slash -------------------------------------------------------------------

export const listSlashCommands = createServerFn({ method: 'GET' })
  .validator((d: { runtimeId: string; workspaceId?: string; includeApp?: boolean }) =>
    shape(d, { runtimeId: 'string', workspaceId: 'string?', includeApp: 'boolean?' }),
  )
  .handler(
    async ({ data }) =>
      run('slash.listCommands', data) as Promise<CoreResult<'listSlashCommandsFor'>>,
  )

// --- tasks -------------------------------------------------------------------

export const listTasks = createServerFn({ method: 'GET' }).handler(
  async () => run('tasks.list') as Promise<CoreResult<'listTasks'>>,
)

export const getTask = createServerFn({ method: 'GET' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('tasks.get', data) as Promise<Nullable<CoreResult<'getTask'>>>)

export const saveTask = createServerFn({ method: 'POST' })
  .validator((d: TaskInput) =>
    shape(d, {
      id: 'string?',
      name: 'string',
      description: 'string',
      runtimeId: 'string',
      prompt: 'string',
      cwd: 'string',
      workspaceId: 'string',
      cron: 'string',
      enabled: 'boolean',
      model: 'string?',
      effort: 'string?',
      webhookIntegrationId: 'string?',
      webhookEvents: 'string[]?',
      webhookFilters: 'object?',
      verifyEnabled: 'boolean?',
      maxRepairAttempts: 'number?',
      timeoutMinutes: 'number?',
      resumeSessionId: 'string?',
      resumeSessionLabel: 'string?',
      fireOnce: 'boolean?',
      scheduledAt: 'number?',
      baseRef: 'string?',
      requireIsolation: 'boolean?',
      requireGhAuth: 'boolean?',
    }),
  )
  .handler(async ({ data }) => run('tasks.save', data) as Promise<CoreResult<'upsertTask'>>)

export const saveTaskWebhook = createServerFn({ method: 'POST' })
  .validator(
    (d: {
      taskId: string
      webhookIntegrationId?: string
      webhookEvents?: string[]
      webhookFilters?: WebhookFilters
    }) =>
      shape(d, {
        taskId: 'string',
        webhookIntegrationId: 'string?',
        webhookEvents: 'string[]?',
        webhookFilters: 'object?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('tasks.saveWebhook', data) as Promise<Nullable<CoreResult<'updateTaskWebhook'>>>,
  )

export const toggleTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string; enabled: boolean }) =>
    shape(d, { id: 'string', enabled: 'boolean' }),
  )
  .handler(
    async ({ data }) =>
      run('tasks.toggle', data) as Promise<Nullable<CoreResult<'setTaskEnabled'>>>,
  )

export const removeTask = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('tasks.remove', data) as Promise<{ ok: true }>)

export const deleteTasks = createServerFn({ method: 'POST' })
  .validator((d: { ids: string[] }) => shape(d, { ids: 'string[]' }))
  .handler(async ({ data }) => run('tasks.delete', data) as Promise<{ ok: true }>)

export const runTaskNow = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(async ({ data }) => run('tasks.runNow', data) as Promise<CoreResult<'runTaskNow'>>)

export const isolateTaskWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('tasks.isolateWorkspace', data) as Promise<CoreResult<'isolateTaskWorkspace'>>,
  )

export const restoreTaskWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('tasks.restoreWorkspace', data) as Promise<CoreResult<'restoreTaskWorkspace'>>,
  )

export const clearTaskWorkspaceQuarantine = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) =>
      run('tasks.clearWorkspaceQuarantine', data) as Promise<
        CoreResult<'clearTaskWorkspaceQuarantine'>
      >,
  )

export const listRunningTaskIds = createServerFn({ method: 'GET' }).handler(
  async () => run('tasks.listRunningIds') as Promise<CoreResult<'listRunningTaskIds'>>,
)

export const createTasksFromPlan = createServerFn({ method: 'POST' })
  .validator(
    (d: { runtimeId: string; workspaceId: string; proposals: PlanProposal[]; enabled?: boolean }) =>
      shape(d, {
        runtimeId: 'string',
        workspaceId: 'string',
        proposals: 'array',
        enabled: 'boolean?',
      }),
  )
  .handler(
    async ({ data }) =>
      run('tasks.createsFromPlan', data) as Promise<CoreResult<'createTasksFromPlan'>>,
  )

// --- usage -------------------------------------------------------------------

export const usageReport = createServerFn({ method: 'GET' })
  .validator((d: { range?: string }) => optionalShape(d, { range: 'string?' }))
  .handler(async ({ data }) => run('usage.report', data) as Promise<CoreResult<'getUsageReport'>>)

export const usagePressure = createServerFn({ method: 'GET' }).handler(
  async () => run('usage.pressure') as Promise<CoreResult<'getUsagePressure'>>,
)

// --- workspaces --------------------------------------------------------------

export const restoreWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { workspaceId: string }) => shape(d, { workspaceId: 'string' }))
  .handler(
    async ({ data }) =>
      run('workspaces.restore', data) as Promise<CoreResult<'restoreWorkspaceById'>>,
  )

export const runWorkspaceBaseline = createServerFn({ method: 'POST' })
  .validator((d: { workspaceId: string }) => shape(d, { workspaceId: 'string' }))
  .handler(
    async ({ data }) =>
      run('workspaces.runBaseline', data) as Promise<CoreResult<'runWorkspaceBaseline'>>,
  )

export const listWorkspaces = createServerFn({ method: 'GET' })
  .validator((d: { projectId?: string }) => optionalShape(d, { projectId: 'string?' }))
  .handler(
    async ({ data }) => run('workspaces.list', data) as Promise<CoreResult<'listWorkspaces'>>,
  )

export const retryWorkspaceSetup = createServerFn({ method: 'POST' })
  .validator((d: { id: string }) => shape(d, { id: 'string' }))
  .handler(
    async ({ data }) => run('workspaces.retrySetup', data) as Promise<CoreResult<'runSetup'>>,
  )

export const archiveWorkspace = createServerFn({ method: 'POST' })
  .validator((d: { id: string; force: boolean }) => shape(d, { id: 'string', force: 'boolean' }))
  .handler(
    async ({ data }) => run('workspaces.archive', data) as Promise<CoreResult<'archiveWorkspace'>>,
  )
