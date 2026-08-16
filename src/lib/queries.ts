/** React Query hooks wrapping the server functions. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../fns'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from './applyRunLiveEvent'
import { useActivityStreamHealthy } from './useActivityLive'
import type { PlanProposal } from './planProposals.ts'

const SEND_MESSAGE_SAFETY_REFETCH_MS = 400

export function useTasks() {
  const streamHealthy = useActivityStreamHealthy()
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => fns.listTasks(),
    // lastRunAt updates ride the activity bus; keep a slow net for schedule edits.
    refetchInterval: streamHealthy ? 15_000 : 5000,
  })
}

export function useTask(id: string) {
  const streamHealthy = useActivityStreamHealthy()
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => fns.getTask({ data: { id } }),
    refetchInterval: streamHealthy ? 15_000 : 5000,
  })
}

export function useNativeSessions(input: { workspaceId: string }, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['nativeSessions', input.workspaceId],
    queryFn: () => fns.listNativeSessions({ data: { workspaceId: input.workspaceId } }),
    enabled: (opts?.enabled ?? true) && !!input.workspaceId,
    staleTime: 15_000,
  })
}

export function loadNativeSessionPage(input: {
  workspaceId: string
  kind: 'claude' | 'codex' | 'grok' | 'antigravity'
  offset: number
  limit?: number
}) {
  return fns.listNativeSessions({ data: input })
}

export function useRuntimes() {
  return useQuery({ queryKey: ['runtimes'], queryFn: () => fns.listRuntimes() })
}

/**
 * Preview the command an (unsaved) runtime draft would spawn. Keyed on the
 * whole draft so typing in the args template re-resolves; results are stable
 * for a given draft, so they never go stale on their own.
 */
export function useCommandPreview(
  draft: {
    bin: string
    argsTemplate: string
    promptViaStdin: boolean
    workspaceId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    isFollowUp?: boolean
  },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['commandPreview', draft],
    queryFn: () => fns.previewCommand({ data: draft }),
    enabled: opts?.enabled ?? true,
    staleTime: Infinity,
  })
}

/** Same preview for a runtime that is already saved, by id. */
export function useCommandPreviewForRuntime(
  input: {
    runtimeId: string
    workspaceId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    isFollowUp?: boolean
  },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['commandPreviewForRuntime', input],
    queryFn: () => fns.previewCommandForRuntime({ data: input }),
    enabled: (opts?.enabled ?? true) && !!input.runtimeId,
    staleTime: Infinity,
  })
}

export function useRuns(taskId?: string, includeArchived = false) {
  const streamHealthy = useActivityStreamHealthy()
  return useQuery({
    queryKey: ['runs', taskId ?? 'all', includeArchived ? 'archived' : 'active'],
    queryFn: () => fns.listRuns({ data: { taskId, limit: 100, includeArchived } }),
    // Activity SSE invalidates on run_changed; poll only when the stream is down.
    refetchInterval: streamHealthy ? false : 3000,
  })
}

export function useRemoveRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeRun({ data: { id } }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.removeQueries({ queryKey: ['conversation', id] })
      qc.removeQueries({ queryKey: ['run', id] })
    },
  })
}

export function useRun(id: string, opts?: { streamHealthy?: boolean }) {
  const streamHealthy = opts?.streamHealthy ?? false
  return useQuery({
    queryKey: ['run', id],
    queryFn: () => fns.getRun({ data: { id } }),
    // SSE drives updates while healthy; poll only when the stream drops.
    refetchInterval: (q) => {
      const running = q.state.data?.status === 'running'
      if (!running) return false
      return streamHealthy ? false : 1000
    },
  })
}

export function useConversation(runId: string, opts?: { streamHealthy?: boolean }) {
  const streamHealthy = opts?.streamHealthy ?? false
  return useQuery({
    queryKey: ['conversation', runId],
    queryFn: () => fns.getConversation({ data: { runId } }),
    // Live stream drives updates while healthy; resume 1s/5s if the stream drops.
    refetchInterval: (q) => {
      if (streamHealthy) return false
      const running = q.state.data?.run.status === 'running'
      return running ? 1000 : 5000
    },
  })
}

/** Files / repo / gh for the run detail right panel (deferred from chat). */
export function useRunWorkspace(
  runId: string,
  opts?: { enabled?: boolean; streamHealthy?: boolean },
) {
  const streamHealthy = opts?.streamHealthy ?? false
  return useQuery({
    queryKey: ['runWorkspace', runId],
    queryFn: () => fns.getRunWorkspace({ data: { runId } }),
    enabled: opts?.enabled ?? true,
    refetchInterval: () => {
      // Panel can refresh slower than chat; invalidate on status/git writes.
      if (!streamHealthy) return 5_000
      return false
    },
  })
}

export function useFileDiff(runId: string, path: string | null) {
  return useQuery({
    queryKey: ['fileDiff', runId, path],
    queryFn: () => fns.getFileDiff({ data: { runId, path: path! } }),
    enabled: !!path,
  })
}

export function useSendMessage(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      prompt: string
      model?: string
      effort?: string
      runtimeMode?: string
    }) => fns.postMessage({ data: { runId, ...input } }),
    onSuccess: (data, vars) => {
      const turnStarted = {
        type: 'turn_started' as const,
        userMessageId: data.userMessageId,
        assistantMessageId: data.assistantMessageId,
        prompt: vars.prompt.trim(),
        createdAt: Date.now(),
      }

      const convKey = ['conversation', runId] as const
      const cached = qc.getQueryData<ConversationCacheSlice>(convKey)
      if (cached) {
        const result = applyRunLiveEvent(cached, turnStarted)
        if (result.action === 'patch') {
          qc.setQueryData(convKey, result.data)
        }
      }

      const runKey = ['run', runId] as const
      const runCached = qc.getQueryData<{
        id: string
        status: string
        stdout: string
        stderr: string
        exitCode: number | null
      }>(runKey)
      if (runCached) {
        const runResult = applyRunLiveEventToRunRow(runCached, turnStarted)
        if (runResult.action === 'patch') {
          qc.setQueryData(runKey, runResult.data)
        }
      }

      // Soft safety net — avoid an immediate refetch that races the first live
      // patches and hitch the chat UI.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: convKey })
        void qc.invalidateQueries({ queryKey: runKey })
      }, SEND_MESSAGE_SAFETY_REFETCH_MS)
    },
  })
}

/**
 * Re-run the project's checks against a finished run. Results stream in over
 * the run's live channel; the invalidation is the safety net for a dropped one.
 */
export function useRerunChecks(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.rerunRunChecks({ data: { runId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', runId] })
      void qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
}

/** Allow or deny a pending supervised tool approval on a live run. */
export function useAnswerApproval(runId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      requestId: string
      /** ACP option id from the prompt's own button list. */
      optionId?: string
      decision?: 'allow' | 'deny'
      message?: string
    }) => fns.answerApproval({ data: { runId, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversation', runId] })
      void qc.invalidateQueries({ queryKey: ['run', runId] })
    },
  })
}

/** Shared invalidation for the git write actions, which all change the diff. */
function useGitMutation<TData, TVars>(runId: string, fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', runId] })
      qc.invalidateQueries({ queryKey: ['runWorkspace', runId] })
      qc.invalidateQueries({ queryKey: ['fileDiff', runId] })
    },
  })
}

export function useCommit(runId: string) {
  return useGitMutation(runId, (vars: { message: string; paths?: string[] }) =>
    fns.commitChanges({ data: { runId, ...vars } }),
  )
}

export function usePush(runId: string) {
  return useGitMutation(runId, () => fns.pushChanges({ data: { runId } }))
}

export function useDiscard(runId: string) {
  return useGitMutation(runId, (vars: { paths?: string[] }) =>
    fns.discardChanges({ data: { runId, ...vars } }),
  )
}

export function useCreateBranch(runId: string) {
  return useGitMutation(runId, (vars: { name: string }) =>
    fns.createBranch({ data: { runId, ...vars } }),
  )
}

export function useOpenPullRequest(runId: string) {
  return useGitMutation(runId, (vars: { title: string; body: string; base?: string }) =>
    fns.openPullRequest({ data: { runId, ...vars } }),
  )
}

export function useInvalidate() {
  const qc = useQueryClient()
  return (keys: string[]) => {
    for (const k of keys) qc.invalidateQueries({ queryKey: [k] })
  }
}

export function useSaveTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.saveTask>[0]['data']) => fns.saveTask({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useToggleTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; enabled: boolean }) => fns.toggleTask({ data }),
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: ['task', id] })
      await qc.cancelQueries({ queryKey: ['tasks'] })
      const previousTask = qc.getQueryData(['task', id])
      const previousTasks = qc.getQueryData(['tasks'])
      const enabledVal = enabled ? 1 : 0
      qc.setQueryData(['task', id], (old: { enabled?: number } | undefined) =>
        old ? { ...old, enabled: enabledVal } : old,
      )
      qc.setQueryData(['tasks'], (old: Array<{ id: string; enabled?: number }> | undefined) =>
        old?.map((t) => (t.id === id ? { ...t, enabled: enabledVal } : t)),
      )
      return { previousTask, previousTasks }
    },
    onError: (_err, { id }, context) => {
      if (context?.previousTask !== undefined) {
        qc.setQueryData(['task', id], context.previousTask)
      }
      if (context?.previousTasks !== undefined) {
        qc.setQueryData(['tasks'], context.previousTasks)
      }
    },
    onSuccess: (updated, { id }) => {
      if (updated) qc.setQueryData(['task', id], updated)
    },
    onSettled: (_data, _err, { id }) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useInstallPlanProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      runtimeId: string
      workspaceId: string
      proposal: PlanProposal
      enabled?: boolean
    }) => fns.installPlanProposal({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useRunNow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.runTaskNow({ data: { id } }),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const runId = data?.runId
      if (runId) {
        await qc.prefetchQuery({
          queryKey: ['conversation', runId],
          queryFn: () => fns.getConversation({ data: { runId } }),
        })
      }
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeTask({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

// --- Projects & workspaces --------------------------------------------------

export function useProjects(initialData?: fns.ProjectWithMeta[]) {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => fns.listProjects(),
    initialData,
    // Loader-seeded data paints immediately; treat it as stale so the client
    // revalidates in the background and swaps in a fresher list if anything changed.
    ...(initialData ? { initialDataUpdatedAt: 0 } : {}),
  })
}

export function useWorkspaces(projectId?: string, initialData?: fns.WorkspaceWithMeta[]) {
  return useQuery({
    queryKey: ['workspaces', projectId ?? 'all'],
    queryFn: () => fns.listWorkspaces({ data: { projectId } }),
    initialData,
    ...(initialData ? { initialDataUpdatedAt: 0 } : {}),
    // Creation + setup run server-side; poll so a 'creating' row flips to
    // 'ready'/'error' on its own instead of the user having to refresh.
    refetchInterval: 5000,
  })
}

export function useProjectBranches(projectId?: string) {
  return useQuery({
    queryKey: ['projectBranches', projectId],
    queryFn: () => fns.listProjectBranches({ data: { projectId: projectId! } }),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  })
}

export function useAddProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.addProject>[0]['data']) => fns.addProject({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      // Register mode creates a main workspace immediately.
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function useCreateLocalFolder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createLocalFolder>[0]['data']) =>
      fns.createLocalFolder({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['local-directories'] })
    },
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.updateProject>[0]['data']) =>
      fns.updateProject({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useRemoveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; deleteFiles: boolean }) => fns.removeProject({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export function useCreateWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createWorkspace>[0]['data']) =>
      fns.createWorkspace({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['projectBranches'] })
    },
  })
}

export function useRetryWorkspaceSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.retryWorkspaceSetup({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  })
}

export function useArchiveWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { id: string; force: boolean }) => fns.archiveWorkspace({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useStartChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      workspaceId: string
      runtimeId: string
      prompt: string
      model?: string
      effort?: string
      runtimeMode?: string
    }) => fns.startChat({ data }),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const runId = data?.runId
      if (runId) {
        await qc.prefetchQuery({
          queryKey: ['conversation', runId],
          queryFn: () => fns.getConversation({ data: { runId } }),
        })
      }
    },
  })
}

export async function fetchLatestRunForWorkspace(workspaceId: string) {
  return fns.getLatestRunForWorkspace({ data: { workspaceId } })
}

// --- Integrations ----------------------------------------------------------

export function useIntegrationProviders() {
  return useQuery({
    queryKey: ['integrationProviders'],
    queryFn: () => fns.listIntegrationProviders(),
    staleTime: 60_000,
  })
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => fns.listIntegrations(),
  })
}

export function useWebhookDeliveries(integrationId?: string) {
  return useQuery({
    queryKey: ['webhookDeliveries', integrationId ?? 'all'],
    queryFn: () => fns.listWebhookDeliveries({ data: { integrationId, limit: 40 } }),
    refetchInterval: 10_000,
  })
}

export function useCreateIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createIntegration>[0]['data']) =>
      fns.createIntegration({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export function useUpdateIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.updateIntegration>[0]['data']) =>
      fns.updateIntegration({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })
}

export function useRotateIntegrationSecret() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.rotateIntegrationSecret({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  })
}

export function useRemoveIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeIntegration({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['webhookDeliveries'] })
    },
  })
}

export function useInstallContext() {
  return useQuery({
    queryKey: ['installContext'],
    queryFn: () => fns.getInstallContext(),
    staleTime: 30_000,
  })
}

export function useInstallIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.installIntegration>[0]['data']) =>
      fns.installIntegration({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['webhookDeliveries'] })
      qc.invalidateQueries({ queryKey: ['installContext'] })
    },
  })
}

// --- Checks & notifications ------------------------------------------------

/** Checks Open Run would propose for a repo, from its package.json scripts. */
export function useSuggestProjectChecks() {
  return useMutation({
    mutationFn: (id: string) => fns.suggestProjectChecks({ data: { id } }),
  })
}

export function useNotifiers() {
  return useQuery({
    queryKey: ['notifiers'],
    queryFn: () => fns.listNotifiers(),
  })
}

export function useSaveNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.saveNotifier>[0]['data']) =>
      fns.saveNotifier({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifiers'] }),
  })
}

export function useRemoveNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeNotifier({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifiers'] })
      qc.invalidateQueries({ queryKey: ['notificationDeliveries'] })
    },
  })
}

export function useTestNotifier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.testNotifier({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificationDeliveries'] }),
  })
}

export function useNotificationDeliveries(notifierId?: string) {
  return useQuery({
    queryKey: ['notificationDeliveries', notifierId ?? 'all'],
    queryFn: () => fns.listNotificationDeliveries({ data: { notifierId } }),
  })
}

// --- Mobile devices --------------------------------------------------------

/**
 * Paired phones and the pairing state. No live events cover devices, and the
 * only thing that changes without a local action is `lastSeenAt`, so a plain
 * interval is right here rather than the stream-health pattern.
 */
export function useMobileStatus() {
  return useQuery({
    queryKey: ['mobileStatus'],
    queryFn: () => fns.mobileStatus(),
    refetchInterval: 30_000,
  })
}

export function useCreatePairingCode() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.createPairingCode(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useCancelPairing() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.cancelPairing({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useRevokeDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.revokeDevice({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

export function useRemoveDevice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.removeDevice({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mobileStatus'] }),
  })
}

// --- Cloud ------------------------------------------------------------------

export function useCloudStatus() {
  return useQuery({
    queryKey: ['cloudStatus'],
    queryFn: () => fns.cloudStatus(),
    refetchInterval: 10_000,
  })
}

export function useStartCloudLogin() {
  return useMutation({
    mutationFn: (origin: string) => fns.startCloudLogin({ data: { origin } }),
  })
}

export function useCompleteCloudLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { code: string; state: string }) => fns.completeCloudLogin({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloudStatus'] }),
  })
}

export function useSkipCloudOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.skipCloudOnboarding(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cloudStatus'] }),
  })
}

export function useSignOutCloud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fns.signOutCloud(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cloudStatus'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
    },
  })
}

export function useStartJiraConnect() {
  return useMutation({
    mutationFn: (origin: string) => fns.startJiraConnect({ data: { origin } }),
  })
}

export function useCompleteHostedJiraConnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { cloudConnectionId: string; siteUrl?: string; name?: string }) =>
      fns.completeHostedJiraConnect({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['installContext'] })
    },
  })
}

export function useIngestTestEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integrationId: string) => fns.ingestTestEvent({ data: { integrationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhookDeliveries'] }),
  })
}
