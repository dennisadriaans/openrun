/** git queries and cache updates. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import { demoFileDiff } from '../../lib/demoConversation.ts'
import { isDemoDetailRun, isDemoMode } from '../../lib/demoData.ts'

export function useFileDiff(runId: string, path: string | null, whole = false) {
  const demo = isDemoMode() && isDemoDetailRun(runId)
  return useQuery({
    // `whole` is part of the key: the two context widths are different diff
    // text for the same file, and flipping the toggle must refetch, not reuse.
    queryKey: ['fileDiff', runId, path, whole ? 'whole' : 'hunks'],
    queryFn: () =>
      demo && path
        ? demoFileDiff(runId, path)
        : fns.getFileDiff({ data: { runId, path: path!, whole } }),
    enabled: !!path,
    // Keep the previous width on screen while the wider one loads, so toggling
    // does not blank the file back to the "Loading diff…" placeholder.
    placeholderData: (prev) => prev,
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

/**
 * One-click ship: commit the run's work as conventional commits, push, open
 * the PR. Runs the agent, so it is far slower than the other git mutations —
 * callers show progress rather than a plain spinner.
 */
export function useShipRun(runId: string) {
  return useGitMutation(runId, (vars: { base?: string; skipPlan?: boolean } | undefined) =>
    fns.shipRun({ data: { runId, ...(vars ?? {}) } }),
  )
}
