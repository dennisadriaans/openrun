/** React Query hooks wrapping the server functions. */
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as fns from '../fns'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from './applyRunLiveEvent'
import { useActivityStreamHealthy } from './useActivityLive'
import { demoConversation, demoFileDiff, demoRunWorkspace } from './demoConversation.ts'
import { isDemoDetailRun, isDemoMode } from './demoData.ts'
import { fileToBase64 } from './attachments.ts'
import { newMessageId } from './messageId.ts'
import type { PlanProposal } from './planProposals.ts'
import type { McpServerConfig } from './mcp.ts'
import type { UsageRange } from './usage.ts'

/** Conversation stays fresh via SSE; avoid window-focus refetches that hitch chat. */
export const CONVERSATION_STALE_MS = 60_000
/** Intent preload of `/runs/$runId` is considered fresh for this long. */
export const RUN_PRELOAD_STALE_MS = 15_000
const WORKSPACE_IDLE_PREFETCH_MS = 400

type McpConfigKey = { runtimeId: string; workspaceId?: string }

function mcpKey(input: McpConfigKey) {
  return ['mcpConfig', input.runtimeId, input.workspaceId ?? ''] as const
}

/** MCP servers as they sit in the runtime's own config file, right now. */
export function useMcpConfig(input: McpConfigKey, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mcpKey(input),
    queryFn: () => fns.getMcpConfig({ data: input }),
    enabled: (opts?.enabled ?? true) && !!input.runtimeId,
    // The file is the source of truth and the user may edit it in an editor
    // while this page is open.
    staleTime: 2000,
  })
}

export function useSaveMcpServer(input: McpConfigKey) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { targetId: string; server: McpServerConfig; previousName?: string }) =>
      fns.saveMcpServer({ data: { ...input, ...vars } }),
    onSuccess: (data) => qc.setQueryData(mcpKey(input), data),
  })
}

export function useRemoveMcpServer(input: McpConfigKey) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { targetId: string; name: string }) =>
      fns.removeMcpServer({ data: { ...input, ...vars } }),
    onSuccess: (data) => qc.setQueryData(mcpKey(input), data),
  })
}

const sharedMcpKey = ['sharedMcp'] as const
const mcpDiscoveryKey = ['mcpDiscovery'] as const

/**
 * Servers defined once in Open Run and projected into every CLI's config.
 * Mutations return the refreshed view plus what the fan-out actually wrote.
 */
export function useSharedMcp() {
  return useQuery({
    queryKey: sharedMcpKey,
    queryFn: () => fns.getSharedMcp(),
    staleTime: 2000,
  })
}

export function useSaveSharedMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { server: McpServerConfig; previousName?: string; force?: boolean }) =>
      fns.saveSharedMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

/**
 * Servers the user already had in a CLI config and has not shared yet. Read
 * only — importing is an explicit action, never something a page load does.
 */
export function useMcpDiscovery() {
  return useQuery({
    queryKey: mcpDiscoveryKey,
    queryFn: () => fns.discoverMcpServers(),
    staleTime: 2000,
  })
}

export function useImportMcpServers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { choices: { name: string; fromTargetId: string }[] }) =>
      fns.importMcpServers({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      qc.setQueryData(mcpDiscoveryKey, data.discovery)
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

export function useRemoveSharedMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string; scope?: 'registry' | 'everywhere' }) =>
      fns.removeSharedMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

export function useSyncSharedMcp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { force?: boolean } = {}) => fns.syncSharedMcp({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      void qc.invalidateQueries({ queryKey: mcpDiscoveryKey })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

const mcpOAuthKey = ['mcpOAuth'] as const

/**
 * Hosted servers Open Run holds a token for. Fetching also refreshes anything
 * near expiry, so opening the page is what keeps the header in each CLI config
 * live.
 */
export function useMcpOAuth() {
  return useQuery({
    queryKey: mcpOAuthKey,
    queryFn: () => fns.getMcpOAuthStatus(),
    staleTime: 5000,
  })
}

export function useStartMcpOAuth() {
  return useMutation({
    mutationFn: (vars: { name: string; redirectUri: string }) => fns.startMcpOAuth({ data: vars }),
  })
}

export function useDisconnectMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string }) => fns.disconnectMcpServer({ data: vars }),
    onSuccess: (data) => {
      qc.setQueryData(sharedMcpKey, data.view)
      qc.setQueryData(mcpOAuthKey, { connections: data.connections, errors: [] })
      void qc.invalidateQueries({ queryKey: ['mcpConfig'] })
    },
  })
}

/**
 * Slash commands available in a composer. The files live on disk and the user
 * may add one while the page is open, so this is refetched rather than pinned.
 */
export function useSlashCommands(
  input: { runtimeId: string; workspaceId?: string; includeApp?: boolean },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [
      'slashCommands',
      input.runtimeId,
      input.workspaceId ?? '',
      input.includeApp ? 'app' : 'files',
    ],
    queryFn: () => fns.listSlashCommands({ data: input }),
    enabled: (opts?.enabled ?? true) && !!input.runtimeId,
    staleTime: 30_000,
  })
}

export function usePlugins(
  input: { runtimeId: string; workspaceId?: string },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['plugins', input.runtimeId, input.workspaceId ?? ''],
    queryFn: () => fns.listPlugins({ data: input }),
    enabled: (opts?.enabled ?? true) && !!input.runtimeId,
    staleTime: 30_000,
  })
}

export function useInstalledPlugins(input: { workspaceId?: string } = {}) {
  return useQuery({
    queryKey: ['installedPlugins', input.workspaceId ?? ''],
    queryFn: () => fns.listInstalledPlugins({ data: input }),
    staleTime: 30_000,
  })
}

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

export function usePresetBins() {
  return useQuery({ queryKey: ['presetBins'], queryFn: () => fns.listPresetBins() })
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

export const RUNS_PAGE_SIZE = 10

export function useRuns(
  taskId?: string,
  includeArchived = false,
  opts?: { limit?: number; offset?: number },
) {
  const streamHealthy = useActivityStreamHealthy()
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  return useQuery({
    queryKey: ['runs', taskId ?? 'all', includeArchived ? 'archived' : 'active', limit, offset],
    queryFn: () => fns.listRuns({ data: { taskId, limit, offset, includeArchived } }),
    // Activity SSE invalidates on run_changed; poll only when the stream is down.
    refetchInterval: streamHealthy ? false : 3000,
  })
}

export function useRunCount(taskId?: string, includeArchived = false) {
  return useQuery({
    queryKey: ['runs', 'count', taskId ?? 'all', includeArchived ? 'archived' : 'active'],
    queryFn: () => fns.countRuns({ data: { taskId, includeArchived } }),
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

export function useMarkRunRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.markRunRead({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })
}

export function conversationQueryOptions(runId: string) {
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return {
    queryKey: ['conversation', runId] as const,
    queryFn: () => (demo ? demoConversation(runId) : fns.getConversation({ data: { runId } })),
    staleTime: CONVERSATION_STALE_MS,
    refetchOnWindowFocus: false as const,
  }
}

export function runWorkspaceQueryOptions(runId: string) {
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return {
    queryKey: ['runWorkspace', runId] as const,
    queryFn: () => (demo ? demoRunWorkspace(runId) : fns.getRunWorkspace({ data: { runId } })),
  }
}

const MAX_IN_FLIGHT_CONVERSATION_PREFETCH = 4

export function prefetchConversation(qc: QueryClient, runId: string) {
  if (
    !qc.getQueryState(['conversation', runId]) &&
    qc.isFetching({ queryKey: ['conversation'] }) >= MAX_IN_FLIGHT_CONVERSATION_PREFETCH
  ) {
    return Promise.resolve()
  }
  return qc.prefetchQuery(conversationQueryOptions(runId))
}

export function prefetchRunWorkspace(qc: QueryClient, runId: string) {
  return qc.prefetchQuery(runWorkspaceQueryOptions(runId))
}

/** After chat has painted, warm the files panel without blocking first paint. */
export function scheduleIdleWorkspacePrefetch(qc: QueryClient, runId: string) {
  const timeout = setTimeout(() => {
    void prefetchRunWorkspace(qc, runId)
  }, WORKSPACE_IDLE_PREFETCH_MS)
  return () => clearTimeout(timeout)
}

/** A run row already in a list query — used to seed the composer before conversation lands. */
export function peekCachedRunSummary(
  qc: QueryClient,
  runId: string,
): { id: string; runtimeId: string; status: string } | undefined {
  for (const [, data] of qc.getQueriesData({ queryKey: ['runs'] })) {
    if (!Array.isArray(data)) continue
    const hit = data.find((row): row is { id: string; runtimeId: string; status: string } =>
      Boolean(row && typeof row === 'object' && 'id' in row && row.id === runId),
    )
    if (hit) return hit
  }
  return undefined
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
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return useQuery({
    ...conversationQueryOptions(runId),
    refetchInterval: (q) => {
      if (demo || streamHealthy) return false
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
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return useQuery({
    ...runWorkspaceQueryOptions(runId),
    enabled: opts?.enabled ?? true,
    refetchInterval: () => {
      if (demo || streamHealthy) return false
      return 5_000
    },
  })
}

/**
 * The run's pull request, if it has one. Polled far slower than the workspace —
 * it costs a `gh` round trip, and the server caches it on the run row anyway.
 */
export function useRunPullRequest(runId: string, opts?: { enabled?: boolean }) {
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return useQuery({
    queryKey: ['runPullRequest', runId] as const,
    queryFn: () => fns.getRunPullRequest({ data: { runId } }),
    enabled: (opts?.enabled ?? true) && !demo,
    refetchInterval: 30_000,
  })
}

export function useFileDiff(runId: string, path: string | null) {
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return useQuery({
    queryKey: ['fileDiff', runId, path],
    queryFn: () =>
      demo && path ? demoFileDiff(runId, path) : fns.getFileDiff({ data: { runId, path: path! } }),
    enabled: !!path,
  })
}

export function useSendMessage(runId: string) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: {
      prompt: string
      runtimeId?: string
      model?: string
      effort?: string
      runtimeMode?: string
      userMessageId: string
      assistantMessageId: string
      /** The agent is working: this message joins the run's queue. */
      queue?: boolean
      /** Interrupt the working agent so the queue starts now. */
      force?: boolean
    }) => fns.postMessage({ data: { runId, ...input } }),
    onMutate: async (vars) => {
      const convKey = ['conversation', runId] as const
      const runKey = ['run', runId] as const
      await qc.cancelQueries({ queryKey: convKey })
      const previous = qc.getQueryData<ConversationCacheSlice>(convKey)
      // A queued message is not a turn — it shows in the queue strip until the
      // server's `queue_changed` frame replaces this optimistic entry.
      if (vars.queue) {
        if (previous) {
          qc.setQueryData<ConversationCacheSlice>(convKey, {
            ...previous,
            queued: [
              ...(previous.queued ?? []),
              {
                id: vars.userMessageId,
                runId,
                prompt: vars.prompt.trim(),
                model: vars.model ?? '',
                effort: vars.effort ?? '',
                runtimeMode: vars.runtimeMode ?? '',
                runtimeId: vars.runtimeId ?? '',
                queuedAt: Date.now(),
              },
            ],
          })
        }
        return { previous }
      }
      const turnStarted = {
        type: 'turn_started' as const,
        userMessageId: vars.userMessageId,
        assistantMessageId: vars.assistantMessageId,
        prompt: vars.prompt.trim(),
        createdAt: Date.now(),
      }
      const base: ConversationCacheSlice = previous ?? {
        run: { id: runId, status: 'idle', stdout: '', stderr: '', exitCode: null },
        messages: [],
        canFollowUp: true,
      }
      const result = applyRunLiveEvent(base, turnStarted)
      if (result.action === 'patch') qc.setQueryData(convKey, result.data)
      const runCached = qc.getQueryData<{
        id: string
        status: string
        stdout: string
        stderr: string
        exitCode: number | null
      }>(runKey)
      if (runCached) {
        const runResult = applyRunLiveEventToRunRow(runCached, turnStarted)
        if (runResult.action === 'patch') qc.setQueryData(runKey, runResult.data)
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(['conversation', runId], context.previous)
      } else {
        qc.removeQueries({ queryKey: ['conversation', runId] })
      }
    },
    onSuccess: (data, vars, context) => {
      // The server parked a message the client thought it was sending (a
      // stale idea of the run's status) — the optimistic turn never happened.
      if (data?.queued && !vars.queue) {
        void qc.refetchQueries({ queryKey: ['conversation', runId] })
        return
      }
      if (!context?.previous) {
        void qc.refetchQueries({ queryKey: ['conversation', runId] })
      }
    },
  })

  type FollowUpInput = {
    prompt: string
    /** Set only when this turn hands the chat to a different runtime. */
    runtimeId?: string
    model?: string
    effort?: string
    runtimeMode?: string
    /** The run is busy — park this message instead of starting a turn. */
    queue?: boolean
    /** Interrupt the running turn so the queue is delivered now. */
    force?: boolean
  }

  const mutate = useCallback(
    (input: FollowUpInput, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate(sendFollowUpVars(input), opts),
    [mutation.mutate],
  )
  const mutateAsync = useCallback(
    (input: FollowUpInput, opts?: Parameters<typeof mutation.mutateAsync>[1]) =>
      mutation.mutateAsync(sendFollowUpVars(input), opts),
    [mutation.mutateAsync],
  )

  return { ...mutation, mutate, mutateAsync }
}

function sendFollowUpVars(input: {
  prompt: string
  runtimeId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  queue?: boolean
  force?: boolean
}) {
  return {
    ...input,
    userMessageId: newMessageId(),
    assistantMessageId: newMessageId(),
  }
}

/**
 * Manual handles on the follow-up queue. The `queue_changed` frame is what
 * normally updates the strip; the invalidation covers a dropped stream.
 */
export function useQueuedMessageActions(runId: string) {
  const qc = useQueryClient()
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['conversation', runId] })
  }
  const drop = useMutation({
    mutationFn: (input: { id: string }) => fns.dequeueMessage({ data: input }),
    onSuccess: settle,
  })
  const clear = useMutation({
    mutationFn: () => fns.clearQueuedMessages({ data: { runId } }),
    onSuccess: settle,
  })
  const flush = useMutation({
    mutationFn: () => fns.flushQueuedMessages({ data: { runId } }),
    onSuccess: settle,
  })
  return { drop, clear, flush }
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
      qc.invalidateQueries({ queryKey: ['runPullRequest', runId] })
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
  return useGitMutation(runId, (vars: { paths?: string[]; resetCommits?: boolean }) =>
    fns.discardChanges({ data: { runId, ...vars } }),
  )
}

export function useRestoreFile(runId: string) {
  return useGitMutation(runId, (vars: { path: string; content: string }) =>
    fns.restoreWorkspaceFile({ data: { runId, ...vars } }),
  )
}

export function useDiscardHunk(runId: string) {
  return useGitMutation(runId, (vars: { path: string; hunkIndex: number }) =>
    fns.discardHunk({ data: { runId, ...vars } }),
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

export function useSaveTaskWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.saveTaskWebhook>[0]['data']) =>
      fns.saveTaskWebhook({ data }),
    onSuccess: (_updated, { taskId }) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['task', taskId] })
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
        await prefetchConversation(qc, runId)
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
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['workspaces'] }),
        qc.invalidateQueries({ queryKey: ['projects'] }),
        qc.invalidateQueries({ queryKey: ['projectBranches'] }),
      ])
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

/**
 * Upload a composer image into a workspace, or `undefined` when no workspace is
 * settled yet — the composer hides its attachment affordances in that case.
 */
export function attachmentUploader(workspaceId: string | undefined) {
  if (!workspaceId) return undefined
  return async (file: File) => {
    const data = await fileToBase64(file)
    return fns.saveAttachment({
      data: { workspaceId, name: file.name, mimeType: file.type, data },
    })
  }
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
      resumeSessionId?: string
      resumeSessionLabel?: string
    }) => fns.startChat({ data }),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      const runId = data?.runId
      if (runId) {
        await prefetchConversation(qc, runId)
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

export function useAutomationSetupContext() {
  return useQuery({
    queryKey: ['automationSetupContext'],
    queryFn: () => fns.getAutomationSetupContext(),
    staleTime: 30_000,
  })
}

/** Bind a connected integration to a workspace + runtime. */
export function useCreateIntegrationAutomation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.createIntegrationAutomation>[0]['data']) =>
      fns.createIntegrationAutomation({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['integrations'] })
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

/**
 * Usage across every configured runtime. The first call after a lot of CLI
 * activity re-parses whatever changed on disk, so keep it cached rather than
 * refetching on focus. Changing the range re-aggregates from the same cache.
 */
export function useUsageReport(range: UsageRange) {
  return useQuery({
    queryKey: ['usageReport', range],
    queryFn: () => fns.usageReport({ data: { range } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  })
}

/**
 * The tightest limit any CLI reports about itself, for the account-menu badge.
 * One file read, so the sidebar can poll it without the full scan.
 */
export function useUsagePressure() {
  return useQuery({
    queryKey: ['usagePressure'],
    queryFn: () => fns.usagePressure(),
    staleTime: 120_000,
    refetchInterval: 300_000,
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

/**
 * Which providers this control plane can connect. Deliberately not gated on
 * `signedIn`: the integrations list has to be honest before anyone signs in,
 * and the endpoint needs no token.
 */
export function useCloudProviders() {
  const { data: cloud } = useCloudStatus()
  return useQuery({
    queryKey: ['cloudProviders', cloud?.cloudUrl ?? 'off'],
    queryFn: () => fns.cloudProviders(),
    enabled: Boolean(cloud?.cloudUrl),
    staleTime: 60_000,
  })
}

export function useStartCloudLogin() {
  return useMutation({
    mutationFn: (input: string | { origin: string; next?: string }) =>
      fns.startCloudLogin({ data: typeof input === 'string' ? { origin: input } : input }),
  })
}

export function useCompleteCloudLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { code: string; state: string }) => fns.completeCloudLogin({ data }),
    // Awaited, not fired and forgotten: the callback navigates as soon as this
    // resolves, and a stale `signedIn: false` status bounces it back to /welcome.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cloudStatus'] })
      // A fresh sign-in can reach a plane the cached catalog never saw.
      void qc.invalidateQueries({ queryKey: ['cloudProviders'] })
    },
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

export function useStartHostedConnect() {
  return useMutation({
    mutationFn: (data: { provider: string; origin: string }) => fns.startHostedConnect({ data }),
  })
}

export function useCompleteHostedConnect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      provider: string
      cloudConnectionId: string
      state?: string
      siteUrl?: string
      accountName?: string
    }) => fns.completeHostedConnect({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['automationSetupContext'] })
      qc.invalidateQueries({ queryKey: ['hostedConnections'] })
    },
  })
}

export function useHostedConnections() {
  const { data: cloud } = useCloudStatus()
  return useQuery({
    queryKey: ['hostedConnections'],
    queryFn: () => fns.listHostedConnections(),
    enabled: Boolean(cloud?.signedIn),
    staleTime: 30_000,
  })
}

export function useDisconnectHostedIntegration() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (integrationId: string) =>
      fns.disconnectHostedIntegration({ data: { integrationId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['hostedConnections'] })
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
