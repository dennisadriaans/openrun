/** Compatibility exports; each feature owns its queries and mutations. */
export { CONVERSATION_STALE_MS, RUN_PRELOAD_STALE_MS } from '../features/runs/queryPolicy.ts'
export {
  useMcpConfig,
  useSaveMcpServer,
  useRemoveMcpServer,
  useSharedMcp,
  useSaveSharedMcpServer,
  useMcpDiscovery,
  useImportMcpServers,
  useRemoveSharedMcpServer,
  useSyncSharedMcp,
  useMcpOAuth,
  useStartMcpOAuth,
  useDisconnectMcpServer,
} from '../features/mcp/queries.ts'
export {
  useSlashCommands,
  usePlugins,
  useInstalledPlugins,
} from '../features/runtimes/extensionQueries.ts'
export {
  useTasks,
  useTask,
  useSaveTask,
  useSaveTaskWebhook,
  useToggleTask,
  useInstallPlanProposal,
  useRunNow,
  useIsolateTaskWorkspace,
  useRestoreTaskWorkspace,
  useClearWorkspaceQuarantine,
  useRunWorkspaceBaseline,
  useDeleteTask,
  useDeleteTasks,
} from '../features/automations/queries.ts'
export { useNativeSessions, loadNativeSessionPage } from '../features/runtimes/nativeQueries.ts'
export {
  useRuntimes,
  usePresetBins,
  useCommandPreview,
  useCommandPreviewForRuntime,
} from '../features/runtimes/queries.ts'
export {
  RUNS_PAGE_SIZE,
  useRunningTaskIds,
  useRuns,
  useConversationNavigationRuns,
  useRunCount,
  useRemoveRun,
  useDeleteRuns,
  useMarkRunRead,
  conversationQueryOptions,
  runWorkspaceQueryOptions,
  prefetchConversation,
  prefetchRunWorkspace,
  scheduleIdleWorkspacePrefetch,
  peekCachedRunSummary,
  useRun,
  useConversation,
  useRunWorkspace,
  useRunPullRequest,
} from '../features/runs/queries.ts'
export {
  useFileDiff,
  useCommit,
  usePush,
  useDiscard,
  useRestoreFile,
  useDiscardHunk,
  useCreateBranch,
  useOpenPullRequest,
  useShipRun,
} from '../features/git/queries.ts'
export {
  useSendMessage,
  useQueuedMessageActions,
  useRerunChecks,
  useAnswerApproval,
} from '../features/chat/queries.ts'
export { useInvalidate } from '../features/shared/invalidation.ts'
export {
  useProjects,
  useWorkspaces,
  useProjectBranches,
  useAddProject,
  useCreateLocalFolder,
  useUpdateProject,
  useRemoveProject,
  useRetryWorkspaceSetup,
  useArchiveWorkspace,
  useSuggestProjectChecks,
} from '../features/workspaces/queries.ts'
export {
  attachmentUploader,
  useOpenNativeChat,
  useRepeatRun,
  useStartChat,
  fetchLatestRunForWorkspace,
  fetchLatestRunForProject,
} from '../features/chat/launchQueries.ts'
export {
  useIntegrationProviders,
  useIntegrations,
  useWebhookDeliveries,
  useCreateIntegration,
  useUpdateIntegration,
  useAutomationSetupContext,
  useCreateIntegrationAutomation,
} from '../features/integrations/queries.ts'
export { useUsageReport, useUsagePressure } from '../features/usage/queries.ts'
export {
  useNotifiers,
  useSaveNotifier,
  useRemoveNotifier,
  useTestNotifier,
  useNotificationDeliveries,
} from '../features/notifications/queries.ts'
export {
  useMobileStatus,
  useCreatePairingCode,
  useCancelPairing,
  useRevokeDevice,
  useRemoveDevice,
} from '../features/devices/queries.ts'
export {
  useCloudStatus,
  useCloudProviders,
  useStartCloudLogin,
  useCompleteCloudLogin,
  useSkipCloudOnboarding,
  useSignOutCloud,
  useStartHostedConnect,
  useCompleteHostedConnect,
  useHostedConnections,
  useDisconnectHostedIntegration,
  useIngestTestEvent,
} from '../features/cloud/queries.ts'
