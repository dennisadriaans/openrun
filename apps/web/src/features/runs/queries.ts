/** runs queries and cache updates. */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import { useActivityStreamHealthy } from '../../lib/useActivityLive.tsx'
import { demoConversation, demoRunWorkspace } from '../../lib/demoConversation.ts'
import { isDemoDetailRun, isDemoDetailTask, isDemoMode } from '../../lib/demoData.ts'
import { CONVERSATION_STALE_MS, WORKSPACE_IDLE_PREFETCH_MS } from './queryPolicy.ts'

export const RUNS_PAGE_SIZE = 10

export function useRunningTaskIds() {
  const streamHealthy = useActivityStreamHealthy()
  return useQuery({
    queryKey: ['runs', 'runningTaskIds'],
    queryFn: () => fns.listRunningTaskIds(),
    refetchInterval: streamHealthy ? false : 3000,
  })
}

export function useRuns(
  taskId?: string,
  includeArchived = false,
  opts?: { limit?: number; offset?: number },
) {
  const streamHealthy = useActivityStreamHealthy()
  const demoTask = isDemoMode() && Boolean(taskId && isDemoDetailTask(taskId))
  const limit = opts?.limit ?? 100
  const offset = opts?.offset ?? 0
  return useQuery({
    queryKey: ['runs', taskId ?? 'all', includeArchived ? 'archived' : 'active', limit, offset],
    queryFn: () =>
      demoTask
        ? Promise.resolve([])
        : fns.listRuns({ data: { taskId, limit, offset, includeArchived } }),
    // Activity SSE invalidates on run_changed; poll only when the stream is down.
    refetchInterval: demoTask || streamHealthy ? false : 3000,
  })
}

export function useConversationNavigationRuns() {
  const streamHealthy = useActivityStreamHealthy()
  return useQuery({
    queryKey: ['runs', 'conversation-navigation'],
    queryFn: () => fns.listConversationNavigationRuns(),
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
      invalidateDeletedRuns(qc, [id])
    },
  })
}

function invalidateDeletedRuns(qc: QueryClient, ids: readonly string[]) {
  qc.invalidateQueries({ queryKey: ['runs'] })
  qc.invalidateQueries({ queryKey: ['dashboard'] })
  for (const id of ids) {
    qc.removeQueries({ queryKey: ['conversation', id] })
    qc.removeQueries({ queryKey: ['run', id] })
    qc.removeQueries({ queryKey: ['runWorkspace', id] })
    qc.removeQueries({ queryKey: ['runPullRequest', id] })
    qc.removeQueries({ queryKey: ['fileDiff', id] })
  }
}

export function useDeleteRuns() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => fns.deleteRuns({ data: { ids } }),
    onSuccess: (_data, ids) => invalidateDeletedRuns(qc, ids),
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
