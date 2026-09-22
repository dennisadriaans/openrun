/** runtimes queries and cache updates. */
import { useQuery } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

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
