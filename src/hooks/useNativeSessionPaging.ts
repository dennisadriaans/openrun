/**
 * Merge server-paged native CLI sessions into the seed groups a picker renders.
 *
 * The first page arrives with the workspace query; "Load more" fetches the rest
 * per runtime kind, so the extra rows live here rather than in the query cache.
 */
import { useEffect, useMemo, useState } from 'react'
import type { NativeSession, NativeSessionGroup, NativeSessionKind } from '../lib/nativeSessions'
import { loadNativeSessionPage } from '../lib/queries'

export function useNativeSessionPaging(
  workspaceId: string,
  groups: NativeSessionGroup[],
  allWorkspaces = false,
) {
  const [extraByKind, setExtraByKind] = useState<
    Partial<Record<NativeSessionKind, NativeSession[]>>
  >({})
  const [hasMoreByKind, setHasMoreByKind] = useState<Partial<Record<NativeSessionKind, boolean>>>(
    {},
  )
  const [loadingKind, setLoadingKind] = useState<NativeSessionKind | null>(null)

  useEffect(() => {
    setExtraByKind({})
    setHasMoreByKind({})
  }, [workspaceId, allWorkspaces])

  const mergedGroups = useMemo(() => {
    return groups.map((group) => {
      const extra = extraByKind[group.kind] ?? []
      const seen = new Set(group.sessions.map((s) => s.sessionId))
      return {
        ...group,
        sessions: [...group.sessions, ...extra.filter((s) => !seen.has(s.sessionId))],
        hasMore: hasMoreByKind[group.kind] ?? group.hasMore,
      }
    })
  }, [groups, extraByKind, hasMoreByKind])

  const loadMore = async (kind: NativeSessionKind) => {
    const group = mergedGroups.find((g) => g.kind === kind)
    if (!group || loadingKind) return
    setLoadingKind(kind)
    try {
      const page = await loadNativeSessionPage({
        ...(allWorkspaces ? { allWorkspaces: true } : { workspaceId }),
        kind,
        offset: group.sessions.length,
      })
      const next = page.groups[0]
      if (!next) return
      setExtraByKind((prev) => ({ ...prev, [kind]: [...(prev[kind] ?? []), ...next.sessions] }))
      setHasMoreByKind((prev) => ({ ...prev, [kind]: next.hasMore }))
    } finally {
      setLoadingKind(null)
    }
  }

  return { mergedGroups, loadingKind, loadMore }
}
