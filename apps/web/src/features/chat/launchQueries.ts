/** chat queries and cache updates. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as fns from '../../fns/index.ts'
import { fileToBase64 } from '@openrun/domain/workspaces/attachments'
import { prefetchConversation } from '../runs/queries.ts'

/**
 * Upload a composer image into a workspace, or `undefined` when no workspace is
 * settled yet — the composer hides its attachment affordances in that case.
 */
export function attachmentUploader(workspaceId: string | undefined, runId?: string) {
  if (!workspaceId) return undefined
  return async (file: File) => {
    const data = await fileToBase64(file)
    return fns.saveAttachment({
      data: { workspaceId, runId, name: file.name, mimeType: file.type, data },
    })
  }
}

export function useOpenNativeChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      workspaceId: string
      runtimeId: string
      sessionId: string
      sessionLabel?: string
      model?: string
      effort?: string
      runtimeMode?: string
    }) => fns.openNativeChat({ data }),
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['workspaces'] })
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

export function useRepeatRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => fns.repeatRun({ data: { runId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['runs'] })
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
    // A refused start is often the server discovering the branch is unusable —
    // a worktree removed by hand demotes the row to `error`/`archived`. Without
    // this the picker keeps offering the branch it just refused, and the next
    // attempt fails the same way.
    onError: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })
}

export async function fetchLatestRunForWorkspace(workspaceId: string) {
  return fns.getLatestRunForWorkspace({ data: { workspaceId } })
}

export async function fetchLatestRunForProject(projectId: string) {
  return fns.getLatestRunForProject({ data: { projectId } })
}
