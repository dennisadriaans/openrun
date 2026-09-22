/** runtimes queries and cache updates. */
import { useQuery } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'

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
