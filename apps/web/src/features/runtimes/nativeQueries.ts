/** runtimes queries and cache updates. */
import { useQuery } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

export function useNativeSessions(
  input: { workspaceId?: string; allWorkspaces?: boolean },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['nativeSessions', input.allWorkspaces ? 'all' : input.workspaceId],
    queryFn: () => fns.listNativeSessions({ data: input }),
    enabled: (opts?.enabled ?? true) && (input.allWorkspaces || !!input.workspaceId),
    staleTime: 15_000,
  })
}

export function loadNativeSessionPage(input: {
  workspaceId?: string
  allWorkspaces?: boolean
  kind: 'claude' | 'codex' | 'grok' | 'antigravity'
  offset: number
  limit?: number
}) {
  return fns.listNativeSessions({ data: input })
}
