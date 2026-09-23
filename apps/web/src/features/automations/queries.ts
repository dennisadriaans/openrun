/** automations queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import { useActivityStreamHealthy } from '../../lib/useActivityLive.tsx'
import { demoTaskDetail, isDemoDetailTask, isDemoMode } from '../../lib/demoData.ts'
import type { PlanProposal } from '@openrun/domain/tasks/planProposals'
import { prefetchConversation } from '../runs/queries.ts'

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
  const demo = isDemoMode() && isDemoDetailTask(id)
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => (demo ? demoTaskDetail(id) : fns.getTask({ data: { id } })),
    refetchInterval: demo ? false : streamHealthy ? 15_000 : 5000,
  })
}

export function useSaveTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Parameters<typeof fns.saveTask>[0]['data']) => fns.saveTask({ data }),
    onSuccess: (saved) => {
      if (saved?.id) qc.setQueryData(['task', saved.id], saved)
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
    // A refused start is often the server discovering the branch is unusable —
    // a worktree removed by hand demotes the row to `error`/`archived`. Without
    // this the picker keeps offering the branch it just refused, and the next
    // attempt fails the same way.
    onError: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

/** Move an automation off the shared main checkout onto its own worktree. */
export function useIsolateTaskWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.isolateTaskWorkspace({ data: { id } }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** Discard everything in an automation's worktree and lift its quarantine. */
export function useRestoreTaskWorkspace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.restoreTaskWorkspace({ data: { id } }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** Lift a quarantine without discarding what the failed run left behind. */
export function useClearWorkspaceQuarantine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fns.clearTaskWorkspaceQuarantine({ data: { id } }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

/** Run the project's checks against a workspace before anything is armed on it. */
export function useRunWorkspaceBaseline(taskId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) => fns.runWorkspaceBaseline({ data: { workspaceId } }),
    onSuccess: () => {
      if (taskId) qc.invalidateQueries({ queryKey: ['task', taskId] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
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

export function useDeleteTasks() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => fns.deleteTasks({ data: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
