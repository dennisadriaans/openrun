/**
 * GENERATED — do not edit.
 *
 * Every operation here comes from `src/contract/operations.ts`. Change the
 * descriptor and run `pnpm contract:generate`; editing this file by hand is
 * undone by the next run and fails the `contract drift` check in CI.
 */
/**
 * Transport-only client. It knows how to reach an operation and how to turn a
 * refusal into an `Error`; it knows nothing about React, Vue, or caching —
 * bind it to whichever reactivity layer a client uses.
 *
 * Browser-safe: `fetch` and nothing else.
 */

export type RouteInfo = { method: 'GET' | 'POST'; path: string }

export const ROUTES: Record<string, RouteInfo> = {
  'cloud.status': { method: 'GET', path: '/api/v1/cloud/status' },
  'cloud.startLogin': { method: 'POST', path: '/api/v1/cloud/start-login' },
  'cloud.completeLogin': { method: 'POST', path: '/api/v1/cloud/complete-login' },
  'cloud.providers': { method: 'GET', path: '/api/v1/cloud/providers' },
  'cloud.skipOnboarding': { method: 'POST', path: '/api/v1/cloud/skip-onboarding' },
  'cloud.signOut': { method: 'POST', path: '/api/v1/cloud/sign-out' },
  'cloud.startHostedConnect': { method: 'POST', path: '/api/v1/cloud/start-hosted-connect' },
  'cloud.completeHostedConnect': { method: 'POST', path: '/api/v1/cloud/complete-hosted-connect' },
  'cloud.listHostedConnections': { method: 'GET', path: '/api/v1/cloud/list-hosted-connections' },
  'dashboard.dashboard': { method: 'GET', path: '/api/v1/dashboard/dashboard' },
  'devices.mobileStatus': { method: 'GET', path: '/api/v1/devices/mobile-status' },
  'devices.createPairingCode': { method: 'POST', path: '/api/v1/devices/create-pairing-code' },
  'devices.cancelPairing': { method: 'POST', path: '/api/v1/devices/cancel-pairing' },
  'devices.revoke': { method: 'POST', path: '/api/v1/devices/revoke' },
  'devices.remove': { method: 'POST', path: '/api/v1/devices/remove' },
  'files.listWorkspace': { method: 'GET', path: '/api/v1/files/list-workspace' },
  'files.readWorkspace': { method: 'GET', path: '/api/v1/files/read-workspace' },
  'files.writeWorkspace': { method: 'POST', path: '/api/v1/files/write-workspace' },
  'files.restoreWorkspace': { method: 'POST', path: '/api/v1/files/restore-workspace' },
  'files.saveAttachment': { method: 'POST', path: '/api/v1/files/save-attachment' },
  'code.highlight': { method: 'POST', path: '/api/v1/code/highlight' },
  'git.getFileDiff': { method: 'GET', path: '/api/v1/git/get-file-diff' },
  'git.commitChanges': { method: 'POST', path: '/api/v1/git/commit-changes' },
  'git.pushChanges': { method: 'POST', path: '/api/v1/git/push-changes' },
  'git.discardChanges': { method: 'POST', path: '/api/v1/git/discard-changes' },
  'git.discardHunk': { method: 'POST', path: '/api/v1/git/discard-hunk' },
  'git.createBranch': { method: 'POST', path: '/api/v1/git/create-branch' },
  'git.openPullRequest': { method: 'POST', path: '/api/v1/git/open-pull-request' },
  'git.shipRun': { method: 'POST', path: '/api/v1/git/ship-run' },
  'git.listProjectBranches': { method: 'GET', path: '/api/v1/git/list-project-branches' },
  'integrations.listProviders': { method: 'GET', path: '/api/v1/integrations/list-providers' },
  'integrations.list': { method: 'GET', path: '/api/v1/integrations/list' },
  'integrations.get': { method: 'GET', path: '/api/v1/integrations/get' },
  'integrations.create': { method: 'POST', path: '/api/v1/integrations/create' },
  'integrations.update': { method: 'POST', path: '/api/v1/integrations/update' },
  'integrations.listWebhookDeliveries': {
    method: 'GET',
    path: '/api/v1/integrations/list-webhook-deliveries',
  },
  'integrations.getAutomationSetupContext': {
    method: 'GET',
    path: '/api/v1/integrations/get-automation-setup-context',
  },
  'integrations.createAutomation': {
    method: 'POST',
    path: '/api/v1/integrations/create-automation',
  },
  'integrations.disconnectHosted': {
    method: 'POST',
    path: '/api/v1/integrations/disconnect-hosted',
  },
  'integrations.ingestTestEvent': {
    method: 'POST',
    path: '/api/v1/integrations/ingest-test-event',
  },
  'mcp.getConfig': { method: 'GET', path: '/api/v1/mcp/get-config' },
  'mcp.saveServer': { method: 'POST', path: '/api/v1/mcp/save-server' },
  'mcp.removeServer': { method: 'POST', path: '/api/v1/mcp/remove-server' },
  'mcp.getShared': { method: 'GET', path: '/api/v1/mcp/get-shared' },
  'mcp.saveSharedServer': { method: 'POST', path: '/api/v1/mcp/save-shared-server' },
  'mcp.removeSharedServer': { method: 'POST', path: '/api/v1/mcp/remove-shared-server' },
  'mcp.discoverServers': { method: 'GET', path: '/api/v1/mcp/discover-servers' },
  'mcp.importServers': { method: 'POST', path: '/api/v1/mcp/import-servers' },
  'mcp.getOAuthStatus': { method: 'GET', path: '/api/v1/mcp/get-oauth-status' },
  'mcp.startOAuth': { method: 'POST', path: '/api/v1/mcp/start-oauth' },
  'mcp.disconnectServer': { method: 'POST', path: '/api/v1/mcp/disconnect-server' },
  'mcp.syncShared': { method: 'POST', path: '/api/v1/mcp/sync-shared' },
  'notifications.listNotifiers': { method: 'GET', path: '/api/v1/notifications/list-notifiers' },
  'notifications.saveNotifier': { method: 'POST', path: '/api/v1/notifications/save-notifier' },
  'notifications.removeNotifier': { method: 'POST', path: '/api/v1/notifications/remove-notifier' },
  'notifications.testNotifier': { method: 'POST', path: '/api/v1/notifications/test-notifier' },
  'notifications.listDeliveries': { method: 'GET', path: '/api/v1/notifications/list-deliveries' },
  'planner.planObjective': { method: 'POST', path: '/api/v1/planner/plan-objective' },
  'planner.installPlanProposal': { method: 'POST', path: '/api/v1/planner/install-plan-proposal' },
  'plugins.list': { method: 'GET', path: '/api/v1/plugins/list' },
  'plugins.listInstalled': { method: 'GET', path: '/api/v1/plugins/list-installed' },
  'projects.list': { method: 'GET', path: '/api/v1/projects/list' },
  'projects.listLocalDirectories': {
    method: 'GET',
    path: '/api/v1/projects/list-local-directories',
  },
  'projects.listLocalPlaces': { method: 'GET', path: '/api/v1/projects/list-local-places' },
  'projects.createLocalFolder': { method: 'POST', path: '/api/v1/projects/create-local-folder' },
  'projects.add': { method: 'POST', path: '/api/v1/projects/add' },
  'projects.update': { method: 'POST', path: '/api/v1/projects/update' },
  'projects.suggestChecks': { method: 'POST', path: '/api/v1/projects/suggest-checks' },
  'projects.remove': { method: 'POST', path: '/api/v1/projects/remove' },
  'runs.listNativeSessions': { method: 'GET', path: '/api/v1/runs/list-native-sessions' },
  'runs.list': { method: 'GET', path: '/api/v1/runs/list' },
  'runs.listConversationNavigation': {
    method: 'GET',
    path: '/api/v1/runs/list-conversation-navigation',
  },
  'runs.count': { method: 'GET', path: '/api/v1/runs/count' },
  'runs.listChecks': { method: 'GET', path: '/api/v1/runs/list-checks' },
  'runs.reRunChecks': { method: 'POST', path: '/api/v1/runs/re-run-checks' },
  'runs.get': { method: 'GET', path: '/api/v1/runs/get' },
  'runs.cancel': { method: 'POST', path: '/api/v1/runs/cancel' },
  'runs.markRead': { method: 'POST', path: '/api/v1/runs/mark-read' },
  'runs.remove': { method: 'POST', path: '/api/v1/runs/remove' },
  'runs.delete': { method: 'POST', path: '/api/v1/runs/delete' },
  'runs.getLatestForWorkspace': { method: 'GET', path: '/api/v1/runs/get-latest-for-workspace' },
  'runs.getLatestForProject': { method: 'GET', path: '/api/v1/runs/get-latest-for-project' },
  'runs.startOptions': { method: 'GET', path: '/api/v1/runs/start-options' },
  'runs.repeat': { method: 'POST', path: '/api/v1/runs/repeat' },
  'runs.startChat': { method: 'POST', path: '/api/v1/runs/start-chat' },
  'runs.openNativeChat': { method: 'POST', path: '/api/v1/runs/open-native-chat' },
  'runs.getConversation': { method: 'GET', path: '/api/v1/runs/get-conversation' },
  'runs.getWorkspace': { method: 'GET', path: '/api/v1/runs/get-workspace' },
  'runs.getPullRequest': { method: 'GET', path: '/api/v1/runs/get-pull-request' },
  'runs.postMessage': { method: 'POST', path: '/api/v1/runs/post-message' },
  'runs.dequeueMessage': { method: 'POST', path: '/api/v1/runs/dequeue-message' },
  'runs.clearQueuedMessages': { method: 'POST', path: '/api/v1/runs/clear-queued-messages' },
  'runs.flushQueuedMessages': { method: 'POST', path: '/api/v1/runs/flush-queued-messages' },
  'runs.answerApproval': { method: 'POST', path: '/api/v1/runs/answer-approval' },
  'runtimes.list': { method: 'GET', path: '/api/v1/runtimes/list' },
  'runtimes.listPresetBins': { method: 'GET', path: '/api/v1/runtimes/list-preset-bins' },
  'runtimes.save': { method: 'POST', path: '/api/v1/runtimes/save' },
  'runtimes.previewCommand': { method: 'POST', path: '/api/v1/runtimes/preview-command' },
  'runtimes.previewCommandFor': { method: 'POST', path: '/api/v1/runtimes/preview-command-for' },
  'runtimes.remove': { method: 'POST', path: '/api/v1/runtimes/remove' },
  'slash.listCommands': { method: 'GET', path: '/api/v1/slash/list-commands' },
  'tasks.list': { method: 'GET', path: '/api/v1/tasks/list' },
  'tasks.get': { method: 'GET', path: '/api/v1/tasks/get' },
  'tasks.save': { method: 'POST', path: '/api/v1/tasks/save' },
  'tasks.saveWebhook': { method: 'POST', path: '/api/v1/tasks/save-webhook' },
  'tasks.toggle': { method: 'POST', path: '/api/v1/tasks/toggle' },
  'tasks.remove': { method: 'POST', path: '/api/v1/tasks/remove' },
  'tasks.delete': { method: 'POST', path: '/api/v1/tasks/delete' },
  'tasks.runNow': { method: 'POST', path: '/api/v1/tasks/run-now' },
  'tasks.isolateWorkspace': { method: 'POST', path: '/api/v1/tasks/isolate-workspace' },
  'tasks.restoreWorkspace': { method: 'POST', path: '/api/v1/tasks/restore-workspace' },
  'tasks.clearWorkspaceQuarantine': {
    method: 'POST',
    path: '/api/v1/tasks/clear-workspace-quarantine',
  },
  'tasks.listRunningIds': { method: 'GET', path: '/api/v1/tasks/list-running-ids' },
  'tasks.createsFromPlan': { method: 'POST', path: '/api/v1/tasks/creates-from-plan' },
  'usage.report': { method: 'GET', path: '/api/v1/usage/report' },
  'usage.pressure': { method: 'GET', path: '/api/v1/usage/pressure' },
  'workspaces.restore': { method: 'POST', path: '/api/v1/workspaces/restore' },
  'workspaces.runBaseline': { method: 'POST', path: '/api/v1/workspaces/run-baseline' },
  'workspaces.list': { method: 'GET', path: '/api/v1/workspaces/list' },
  'workspaces.retrySetup': { method: 'POST', path: '/api/v1/workspaces/retry-setup' },
  'workspaces.archive': { method: 'POST', path: '/api/v1/workspaces/archive' },
}

export type ClientOptions = {
  /** Origin the server is on. Same-origin by default. */
  baseUrl?: string
  /** Bearer token for a non-browser client. Browsers send the access cookie. */
  token?: string
  fetch?: typeof globalThis.fetch
}

/** Thrown for any non-2xx answer, carrying the server's own words. */
export class OpenRunError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'OpenRunError'
    this.status = status
  }
}

export class OpenRunClient {
  private readonly baseUrl: string
  private readonly token?: string
  private readonly doFetch: typeof globalThis.fetch

  constructor(options: ClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '')
    this.token = options.token
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /** Reach one operation by id. Every method below is a thin wrapper over this. */
  async call(id: string, input?: unknown): Promise<unknown> {
    const route = ROUTES[id]
    if (!route) throw new OpenRunError(`Unknown operation "${id}"`, 404)

    const headers: Record<string, string> = { accept: 'application/json' }
    if (this.token) headers.authorization = `Bearer ${this.token}`

    let url = `${this.baseUrl}${route.path}`
    let body: string | undefined

    if (route.method === 'GET') {
      if (input !== undefined) {
        url += `?input=${encodeURIComponent(JSON.stringify(input))}`
      }
    } else if (input !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(input)
    }

    const response = await this.doFetch(url, { method: route.method, headers, body })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : `Request failed with ${response.status}`
      throw new OpenRunError(message, response.status)
    }
    return payload
  }

  cloudStatus(): Promise<unknown> {
    return this.call('cloud.status')
  }

  startCloudLogin(input: { origin: string; next?: string }): Promise<unknown> {
    return this.call('cloud.startLogin', input)
  }

  completeCloudLogin(input: { code: string; state: string }): Promise<unknown> {
    return this.call('cloud.completeLogin', input)
  }

  /** Which providers this control plane can connect. Public — no session needed. */
  cloudProviders(): Promise<unknown> {
    return this.call('cloud.providers')
  }

  skipCloudOnboarding(): Promise<unknown> {
    return this.call('cloud.skipOnboarding')
  }

  signOutCloud(): Promise<unknown> {
    return this.call('cloud.signOut')
  }

  startHostedConnect(input: { provider: string; origin: string }): Promise<unknown> {
    return this.call('cloud.startHostedConnect', input)
  }

  completeHostedConnect(input: {
    provider: string
    cloudConnectionId: string
    state?: string
    siteUrl?: string
    accountName?: string
  }): Promise<unknown> {
    return this.call('cloud.completeHostedConnect', input)
  }

  listHostedConnections(): Promise<unknown> {
    return this.call('cloud.listHostedConnections')
  }

  dashboard(): Promise<unknown> {
    return this.call('dashboard.dashboard')
  }

  mobileStatus(): Promise<unknown> {
    return this.call('devices.mobileStatus')
  }

  createPairingCode(): Promise<unknown> {
    return this.call('devices.createPairingCode')
  }

  cancelPairing(input: { id: string }): Promise<unknown> {
    return this.call('devices.cancelPairing', input)
  }

  revokeDevice(input: { id: string }): Promise<unknown> {
    return this.call('devices.revoke', input)
  }

  removeDevice(input: { id: string }): Promise<unknown> {
    return this.call('devices.remove', input)
  }

  listWorkspaceFiles(input: { runId: string; dir?: string }): Promise<unknown> {
    return this.call('files.listWorkspace', input)
  }

  readWorkspaceFile(input: { runId: string; path: string }): Promise<unknown> {
    return this.call('files.readWorkspace', input)
  }

  writeWorkspaceFile(input: { runId: string; path: string; content: string }): Promise<unknown> {
    return this.call('files.writeWorkspace', input)
  }

  restoreWorkspaceFile(input: { runId: string; path: string; content: string }): Promise<unknown> {
    return this.call('files.restoreWorkspace', input)
  }

  /** Upload a composer image; `data` is raw base64 without the data-URL prefix. */
  saveAttachment(input: {
    workspaceId: string
    runId?: string
    name: string
    mimeType: string
    data: string
  }): Promise<unknown> {
    return this.call('files.saveAttachment', input)
  }

  /** Tokenize a snippet with the app's own highlighter; answers class names, not colours. */
  highlightCodeBlock(input: { code: string; language?: string; path?: string }): Promise<unknown> {
    return this.call('code.highlight', input)
  }

  getFileDiff(input: { runId: string; path: string; whole?: boolean }): Promise<unknown> {
    return this.call('git.getFileDiff', input)
  }

  commitChanges(input: { runId: string; message: string; paths?: string[] }): Promise<unknown> {
    return this.call('git.commitChanges', input)
  }

  pushChanges(input: { runId: string }): Promise<unknown> {
    return this.call('git.pushChanges', input)
  }

  discardChanges(input: {
    runId: string
    paths?: string[]
    resetCommits?: boolean
  }): Promise<unknown> {
    return this.call('git.discardChanges', input)
  }

  discardHunk(input: { runId: string; path: string; hunkIndex: number }): Promise<unknown> {
    return this.call('git.discardHunk', input)
  }

  createBranch(input: { runId: string; name: string }): Promise<unknown> {
    return this.call('git.createBranch', input)
  }

  openPullRequest(input: {
    runId: string
    title: string
    body: string
    base?: string
  }): Promise<unknown> {
    return this.call('git.openPullRequest', input)
  }

  shipRun(input: { runId: string; base?: string; skipPlan?: boolean }): Promise<unknown> {
    return this.call('git.shipRun', input)
  }

  listProjectBranches(input: { projectId: string }): Promise<unknown> {
    return this.call('git.listProjectBranches', input)
  }

  listIntegrationProviders(): Promise<unknown> {
    return this.call('integrations.listProviders')
  }

  listIntegrations(): Promise<unknown> {
    return this.call('integrations.list')
  }

  getIntegration(input: { id: string }): Promise<unknown> {
    return this.call('integrations.get', input)
  }

  createIntegration(input: { provider: string }): Promise<unknown> {
    return this.call('integrations.create', input)
  }

  updateIntegration(input: { id: string }): Promise<unknown> {
    return this.call('integrations.update', input)
  }

  listWebhookDeliveries(input?: { integrationId?: string; limit?: number }): Promise<unknown> {
    return this.call('integrations.listWebhookDeliveries', input)
  }

  getAutomationSetupContext(): Promise<unknown> {
    return this.call('integrations.getAutomationSetupContext')
  }

  /** Bind a connected integration to a workspace + runtime so deliveries run. */
  createIntegrationAutomation(input: {
    integrationId: string
    workspaceId: string
    runtimeId: string
    trigger?: Record<string, unknown>
    events?: string[]
    name?: string
    prompt?: string
    enabled?: boolean
  }): Promise<unknown> {
    return this.call('integrations.createAutomation', input)
  }

  disconnectHostedIntegration(input: { integrationId: string }): Promise<unknown> {
    return this.call('integrations.disconnectHosted', input)
  }

  ingestTestEvent(input: { integrationId: string }): Promise<unknown> {
    return this.call('integrations.ingestTestEvent', input)
  }

  getMcpConfig(input: { runtimeId: string; workspaceId?: string }): Promise<unknown> {
    return this.call('mcp.getConfig', input)
  }

  saveMcpServer(input: {
    runtimeId: string
    workspaceId?: string
    targetId: string
    server: Record<string, unknown>
    previousName?: string
  }): Promise<unknown> {
    return this.call('mcp.saveServer', input)
  }

  removeMcpServer(input: {
    runtimeId: string
    workspaceId?: string
    targetId: string
    name: string
  }): Promise<unknown> {
    return this.call('mcp.removeServer', input)
  }

  getSharedMcp(): Promise<unknown> {
    return this.call('mcp.getShared')
  }

  saveSharedMcpServer(input: {
    server: Record<string, unknown>
    previousName?: string
    force?: boolean
  }): Promise<unknown> {
    return this.call('mcp.saveSharedServer', input)
  }

  removeSharedMcpServer(input: { name: string; scope?: string }): Promise<unknown> {
    return this.call('mcp.removeSharedServer', input)
  }

  discoverMcpServers(): Promise<unknown> {
    return this.call('mcp.discoverServers')
  }

  importMcpServers(input: { choices: unknown[] }): Promise<unknown> {
    return this.call('mcp.importServers', input)
  }

  getMcpOAuthStatus(): Promise<unknown> {
    return this.call('mcp.getOAuthStatus')
  }

  startMcpOAuth(input: { name: string; redirectUri: string }): Promise<unknown> {
    return this.call('mcp.startOAuth', input)
  }

  disconnectMcpServer(input: { name: string }): Promise<unknown> {
    return this.call('mcp.disconnectServer', input)
  }

  syncSharedMcp(input?: { force?: boolean }): Promise<unknown> {
    return this.call('mcp.syncShared', input)
  }

  listNotifiers(): Promise<unknown> {
    return this.call('notifications.listNotifiers')
  }

  saveNotifier(input: {
    kind: string
    name: string
    target?: string
    enabled: boolean
  }): Promise<unknown> {
    return this.call('notifications.saveNotifier', input)
  }

  removeNotifier(input: { id: string }): Promise<unknown> {
    return this.call('notifications.removeNotifier', input)
  }

  testNotifier(input: { id: string }): Promise<unknown> {
    return this.call('notifications.testNotifier', input)
  }

  listNotificationDeliveries(input?: { notifierId?: string; limit?: number }): Promise<unknown> {
    return this.call('notifications.listDeliveries', input)
  }

  planObjective(input: {
    objective: string
    runtimeId: string
    workspaceId: string
  }): Promise<unknown> {
    return this.call('planner.planObjective', input)
  }

  installPlanProposal(input: {
    runtimeId: string
    workspaceId: string
    proposal: Record<string, unknown>
    enabled?: boolean
  }): Promise<unknown> {
    return this.call('planner.installPlanProposal', input)
  }

  listPlugins(input: { runtimeId: string; workspaceId?: string }): Promise<unknown> {
    return this.call('plugins.list', input)
  }

  listInstalledPlugins(input?: { workspaceId?: string }): Promise<unknown> {
    return this.call('plugins.listInstalled', input)
  }

  listProjects(): Promise<unknown> {
    return this.call('projects.list')
  }

  listLocalDirectories(input?: { dir?: string; showHidden?: boolean }): Promise<unknown> {
    return this.call('projects.listLocalDirectories', input)
  }

  listLocalPlaces(): Promise<unknown> {
    return this.call('projects.listLocalPlaces')
  }

  createLocalFolder(input: { parent?: string; name: string }): Promise<unknown> {
    return this.call('projects.createLocalFolder', input)
  }

  addProject(input: {
    mode: string
    url?: string
    path?: string
    name?: string
    setupCommand?: string
  }): Promise<unknown> {
    return this.call('projects.add', input)
  }

  updateProject(input: {
    id: string
    name?: string
    setupCommand?: string
    defaultBranch?: string
    checks?: unknown[]
  }): Promise<unknown> {
    return this.call('projects.update', input)
  }

  /** Checks Open Run would propose for this repo, from its package.json scripts. */
  suggestProjectChecks(input: { id: string }): Promise<unknown> {
    return this.call('projects.suggestChecks', input)
  }

  removeProject(input: { id: string; deleteFiles: boolean }): Promise<unknown> {
    return this.call('projects.remove', input)
  }

  listNativeSessions(input: {
    workspaceId?: string
    allWorkspaces?: boolean
    kind?: string
    offset?: number
    limit?: number
  }): Promise<unknown> {
    return this.call('runs.listNativeSessions', input)
  }

  listRuns(input?: {
    taskId?: string
    limit?: number
    offset?: number
    includeArchived?: boolean
  }): Promise<unknown> {
    return this.call('runs.list', input)
  }

  listConversationNavigationRuns(): Promise<unknown> {
    return this.call('runs.listConversationNavigation')
  }

  countRuns(input?: { taskId?: string; includeArchived?: boolean }): Promise<unknown> {
    return this.call('runs.count', input)
  }

  listRunChecks(input: { runId: string }): Promise<unknown> {
    return this.call('runs.listChecks', input)
  }

  rerunRunChecks(input: { runId: string }): Promise<unknown> {
    return this.call('runs.reRunChecks', input)
  }

  getRun(input: { id: string }): Promise<unknown> {
    return this.call('runs.get', input)
  }

  cancelRun(input: { id: string }): Promise<unknown> {
    return this.call('runs.cancel', input)
  }

  markRunRead(input: { id: string }): Promise<unknown> {
    return this.call('runs.markRead', input)
  }

  removeRun(input: { id: string }): Promise<unknown> {
    return this.call('runs.remove', input)
  }

  deleteRuns(input: { ids: string[] }): Promise<unknown> {
    return this.call('runs.delete', input)
  }

  getLatestRunForWorkspace(input: { workspaceId: string }): Promise<unknown> {
    return this.call('runs.getLatestForWorkspace', input)
  }

  getLatestRunForProject(input: { projectId: string }): Promise<unknown> {
    return this.call('runs.getLatestForProject', input)
  }

  startRunOptions(): Promise<unknown> {
    return this.call('runs.startOptions')
  }

  repeatRun(input: { runId: string }): Promise<unknown> {
    return this.call('runs.repeat', input)
  }

  startChat(input: {
    workspaceId: string
    runtimeId: string
    prompt: string
    model?: string
    effort?: string
    runtimeMode?: string
    resumeSessionId?: string
    resumeSessionLabel?: string
  }): Promise<unknown> {
    return this.call('runs.startChat', input)
  }

  openNativeChat(input: {
    workspaceId: string
    runtimeId: string
    sessionId: string
    sessionLabel?: string
    model?: string
    effort?: string
    runtimeMode?: string
  }): Promise<unknown> {
    return this.call('runs.openNativeChat', input)
  }

  getConversation(input: { runId: string }): Promise<unknown> {
    return this.call('runs.getConversation', input)
  }

  getRunWorkspace(input: { runId: string }): Promise<unknown> {
    return this.call('runs.getWorkspace', input)
  }

  getRunPullRequest(input: { runId: string }): Promise<unknown> {
    return this.call('runs.getPullRequest', input)
  }

  postMessage(input: {
    runId: string
    prompt: string
    runtimeId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    userMessageId?: string
    assistantMessageId?: string
    force?: boolean
  }): Promise<unknown> {
    return this.call('runs.postMessage', input)
  }

  /** Drop one follow-up waiting on the current turn. */
  dequeueMessage(input: { id: string }): Promise<unknown> {
    return this.call('runs.dequeueMessage', input)
  }

  /** Drop every follow-up waiting on a run. */
  clearQueuedMessages(input: { runId: string }): Promise<unknown> {
    return this.call('runs.clearQueuedMessages', input)
  }

  /** Deliver the next queued follow-up on a run that is no longer working. */
  flushQueuedMessages(input: { runId: string }): Promise<unknown> {
    return this.call('runs.flushQueuedMessages', input)
  }

  /** Answer a pending tool-approval on a supervised run (allow/deny). The run detail UI calls this from the approval prompt; unanswered requests auto-deny on a timeout in the executor. */
  answerApproval(input: {
    runId: string
    requestId: string
    optionId?: string
    decision?: string
    message?: string
  }): Promise<unknown> {
    return this.call('runs.answerApproval', input)
  }

  listRuntimes(): Promise<unknown> {
    return this.call('runtimes.list')
  }

  listPresetBins(): Promise<unknown> {
    return this.call('runtimes.listPresetBins')
  }

  saveRuntime(input?: { label?: string; bin?: string }): Promise<unknown> {
    return this.call('runtimes.save', input)
  }

  /** Resolve the exact argv a runtime draft would spawn — no run row, no process. POST because the Runtimes editor previews an unsaved template. */
  previewCommand(input?: { runtimeId?: string; bin?: string }): Promise<unknown> {
    return this.call('runtimes.previewCommand', input)
  }

  /** Same preview for a saved runtime, by id (tooling / non-UI callers). */
  previewCommandForRuntime(input: {
    runtimeId: string
    workspaceId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    isFollowUp?: boolean
  }): Promise<unknown> {
    return this.call('runtimes.previewCommandFor', input)
  }

  removeRuntime(input: { id: string }): Promise<unknown> {
    return this.call('runtimes.remove', input)
  }

  listSlashCommands(input: {
    runtimeId: string
    workspaceId?: string
    includeApp?: boolean
  }): Promise<unknown> {
    return this.call('slash.listCommands', input)
  }

  listTasks(): Promise<unknown> {
    return this.call('tasks.list')
  }

  getTask(input: { id: string }): Promise<unknown> {
    return this.call('tasks.get', input)
  }

  saveTask(input: {
    id?: string
    name: string
    description: string
    runtimeId: string
    prompt: string
    cwd: string
    workspaceId: string
    cron: string
    enabled: boolean
    model?: string
    effort?: string
    webhookIntegrationId?: string
    webhookEvents?: string[]
    webhookFilters?: Record<string, unknown>
    verifyEnabled?: boolean
    maxRepairAttempts?: number
    timeoutMinutes?: number
    resumeSessionId?: string
    resumeSessionLabel?: string
    fireOnce?: boolean
    scheduledAt?: number
    baseRef?: string
    requireIsolation?: boolean
    requireGhAuth?: boolean
  }): Promise<unknown> {
    return this.call('tasks.save', input)
  }

  saveTaskWebhook(input: {
    taskId: string
    webhookIntegrationId?: string
    webhookEvents?: string[]
    webhookFilters?: Record<string, unknown>
  }): Promise<unknown> {
    return this.call('tasks.saveWebhook', input)
  }

  toggleTask(input: { id: string; enabled: boolean }): Promise<unknown> {
    return this.call('tasks.toggle', input)
  }

  removeTask(input: { id: string }): Promise<unknown> {
    return this.call('tasks.remove', input)
  }

  deleteTasks(input: { ids: string[] }): Promise<unknown> {
    return this.call('tasks.delete', input)
  }

  runTaskNow(input: { id: string }): Promise<unknown> {
    return this.call('tasks.runNow', input)
  }

  isolateTaskWorkspace(input: { id: string }): Promise<unknown> {
    return this.call('tasks.isolateWorkspace', input)
  }

  restoreTaskWorkspace(input: { id: string }): Promise<unknown> {
    return this.call('tasks.restoreWorkspace', input)
  }

  clearTaskWorkspaceQuarantine(input: { id: string }): Promise<unknown> {
    return this.call('tasks.clearWorkspaceQuarantine', input)
  }

  listRunningTaskIds(): Promise<unknown> {
    return this.call('tasks.listRunningIds')
  }

  createTasksFromPlan(input: {
    runtimeId: string
    workspaceId: string
    proposals: unknown[]
    enabled?: boolean
  }): Promise<unknown> {
    return this.call('tasks.createsFromPlan', input)
  }

  usageReport(input?: { range?: string }): Promise<unknown> {
    return this.call('usage.report', input)
  }

  usagePressure(): Promise<unknown> {
    return this.call('usage.pressure')
  }

  restoreWorkspace(input: { workspaceId: string }): Promise<unknown> {
    return this.call('workspaces.restore', input)
  }

  runWorkspaceBaseline(input: { workspaceId: string }): Promise<unknown> {
    return this.call('workspaces.runBaseline', input)
  }

  listWorkspaces(input?: { projectId?: string }): Promise<unknown> {
    return this.call('workspaces.list', input)
  }

  retryWorkspaceSetup(input: { id: string }): Promise<unknown> {
    return this.call('workspaces.retrySetup', input)
  }

  archiveWorkspace(input: { id: string; force: boolean }): Promise<unknown> {
    return this.call('workspaces.archive', input)
  }
}
