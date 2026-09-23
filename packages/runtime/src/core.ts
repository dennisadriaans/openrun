/** Public local-runtime API. Startup is isolated from feature implementations. */
import './bootstrap.ts'

export {
  addProject,
  archiveWorkspace,
  createLocalFolder,
  deleteProject,
  getProject,
  getWorkspace,
  listLocalDirectories,
  listLocalPlaces,
  listProjectBranches,
  listProjects,
  listWorkspaces,
  resolveWorkspacePath,
  runSetup,
  suggestProjectChecks,
  updateProject,
} from './workspaces/workspaces.ts'

export type { ProjectRow, WorkspaceRow } from './storage/db.ts'

export type {
  LocalDirEntry,
  LocalDirListing,
  LocalPlace,
  ProjectWithMeta,
  WorkspaceWithMeta,
} from './workspaces/workspaces.ts'

export {
  deleteNotifier,
  getNotifier,
  listNotificationDeliveries,
  listNotifiers,
  testNotifier,
  upsertNotifier,
  type NotificationDeliveryListItem,
  type NotifierInput,
} from './notifications/notify.ts'

export type { NotificationDeliveryRow, NotifierRow } from './storage/db.ts'

export {
  activePairing,
  cancelPairing,
  createPairingCode,
  deleteDevice,
  getDevice,
  listDevices,
  revokeDevice,
  type PairingCode,
} from './mobile/devices.ts'

export { MOBILE_ENABLE_HINT, MOBILE_ENV_VAR, mobileEnabled } from './mobile/config.ts'

export { lanBaseUrls } from './mobile/lan.ts'

export { apnsConfigured } from './mobile/apns.ts'

export { mobileStatus } from './mobile/status.ts'

export type { DeviceRow, DevicePairingRow } from './storage/db.ts'

export {
  type RuntimeWithModels,
  listRuntimes,
  listRuntimesWithStatus,
  getRuntime,
  type RuntimeInput,
  upsertRuntime,
  deleteRuntime,
  listPresetBinStatus,
  previewRuntimeCommandById,
} from './application/runtimes.ts'
export {
  type McpConfigView,
  getMcpConfig,
  saveMcpServerConfig,
  removeMcpServerConfig,
  getSharedMcpConfig,
  saveSharedMcpServerConfig,
  discoverMcpServersConfig,
  importMcpServersConfig,
  removeSharedMcpServerConfig,
  syncSharedMcpConfig,
  getMcpOAuthStatus,
  startMcpOAuth,
  disconnectMcpServer,
} from './application/mcp.ts'
export {
  listSlashCommandsFor,
  listPluginsFor,
  listInstalledPlugins,
} from './application/extensions.ts'
export {
  nextRun,
  type TaskWithMeta,
  listTasks,
  listNativeSessions,
  getTask,
} from './application/taskQueries.ts'
export {
  type TaskInput,
  upsertTask,
  updateTaskWebhook,
  setTaskEnabled,
  deleteTask,
  deleteTasks,
  listPendingRuns,
  runTaskNow,
  isolateTaskWorkspace,
  restoreTaskWorkspace,
  restoreWorkspaceById,
  clearTaskWorkspaceQuarantine,
} from './application/taskCommands.ts'
export { type BaselineResult, runWorkspaceBaseline } from './application/workspaceChecks.ts'
export {
  getLatestRunForWorkspace,
  getLatestRunForProject,
  type StartRunWorkspaceOption,
  type StartRunRuntimeOption,
  startRunOptions,
  startChat,
  repeatRun,
  openNativeChat,
} from './application/launch.ts'
export {
  type RunSummary,
  countRuns,
  listRunningTaskIds,
  listRuns,
  type ConversationNavigationRun,
  listConversationNavigationRuns,
  listRunChecks,
  rerunRunChecks,
  getRun,
  markRunRead,
  cancelRun,
  listQueuedFollowUps,
  dequeueFollowUp,
  clearQueuedFollowUps,
  flushQueuedFollowUps,
  archiveRun,
  unarchiveRun,
  deleteRun,
  deleteRuns,
} from './application/runs.ts'
export {
  type ChatMessage,
  getConversation,
  getRunPullRequest,
  invalidateRunPullRequest,
  getRunWorkspace,
  answerApproval,
  type PostMessageResult,
  postMessage,
} from './application/conversation.ts'
export {
  getFileDiff,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  restoreWorkspaceFile,
  saveWorkspaceAttachment,
  commitChanges,
  pushChanges,
  discardChanges,
  discardHunk,
  createBranch,
  openPullRequest,
  type ShipStep,
  type ShipRunResult,
  shipRun,
} from './application/git.ts'
export { getDashboard } from './application/dashboard.ts'
export { planObjective, installPlanProposal, createTasksFromPlan } from './application/planner.ts'
export { getUsageReport } from './application/usage.ts'
export { createIntegrationAutomation, listWebhookDeliveries } from './application/integrations.ts'
export { completeCloudLoginAndFinish } from './application/cloud.ts'
export { checkRuntimeInstalled } from './application/runtimes.ts'
export { previewRuntimeCommand } from './application/runtimes.ts'
export type { PreviewCommandInput, PreviewCommandResult } from './application/runtimes.ts'
export type { PlanProposal } from './application/planner.ts'
export { readUsagePressure as getUsagePressure } from './runtimes/usage.ts'
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
} from './integrations/index.ts'
export {
  afterSignIn,
  bootCloud,
  completeCloudLogin,
  completeHostedConnect,
  disconnectHostedIntegration,
  getCloudStatus,
  ingestTestEvent,
  listCloudProviders,
  listHostedConnections,
  signOutAndDisconnect,
  skipCloudOnboarding,
  startCloudLogin,
  startHostedConnect,
} from './cloud/index.ts'
export type { CloudStatus } from '@openrun/domain/cloud/types'
export type { CloudProviderCatalog } from '@openrun/domain/cloud/providers'
