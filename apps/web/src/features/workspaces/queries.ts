/** workspaces queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

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

/** Checks Open Run would propose for a repo, from its package.json scripts. */
export function useSuggestProjectChecks() {
  return useMutation({
    mutationFn: (id: string) => fns.suggestProjectChecks({ data: { id } }),
  })
}
