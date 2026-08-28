/**
 * Browser-side live tail for a run detail page.
 *
 * Opens an SSE connection against `/api/runs/$runId/stream` through
 * `liveStream.ts`, which owns reconnect and the heartbeat watchdog. Log,
 * turn_event, turn_started, and status frames patch the conversation query
 * cache in place. File-panel data still invalidates on status / turn_finished.
 * While the stream is healthy, HTTP polling stays off; on stream loss it
 * resumes 1s / 5s.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from './applyRunLiveEvent'
import { openLiveStream } from './liveStream.ts'
import type { RunLiveEvent } from './runLive'
import { runLiveStreamPath } from './runLive'
import { isDemoDetailRun, isDemoMode } from './demoData.ts'

export function useRunLive(runId: string): { streamHealthy: boolean } {
  const qc = useQueryClient()
  const demo = isDemoMode() && isDemoDetailRun(runId)
  const [streamHealthy, setStreamHealthy] = useState(demo)

  useEffect(() => {
    if (demo) {
      setStreamHealthy(true)
      return
    }
    if (typeof EventSource === 'undefined') return

    const refetchConversation = () => {
      void qc.invalidateQueries({ queryKey: ['conversation', runId] })
      void qc.invalidateQueries({ queryKey: ['run', runId] })
      void qc.invalidateQueries({ queryKey: ['runWorkspace', runId] })
    }

    const applyFrame = (event: RunLiveEvent) => {
      const convKey = ['conversation', runId] as const
      const runKey = ['run', runId] as const

      const cached = qc.getQueryData<ConversationCacheSlice>(convKey)
      if (cached) {
        const result = applyRunLiveEvent(cached, event)
        if (result.action === 'patch') {
          qc.setQueryData(convKey, result.data)
          if (event.type === 'status' || event.type === 'turn_finished') {
            void qc.invalidateQueries({ queryKey: ['runWorkspace', runId] })
          }
        } else if (result.action === 'refetch') {
          refetchConversation()
          return
        }
      } else if (
        event.type === 'status' ||
        event.type === 'turn_started' ||
        event.type === 'turn_finished'
      ) {
        refetchConversation()
        return
      }

      const runCached = qc.getQueryData<{
        id: string
        status: string
        stdout: string
        stderr: string
        exitCode: number | null
      }>(runKey)
      if (runCached) {
        const runResult = applyRunLiveEventToRunRow(runCached, event)
        if (runResult.action === 'patch') {
          qc.setQueryData(runKey, runResult.data)
        } else if (runResult.action === 'refetch') {
          void qc.invalidateQueries({ queryKey: runKey })
        }
      }
    }

    const stream = openLiveStream({
      id: `run:${runId}`,
      label: 'Run tail',
      path: runLiveStreamPath(runId),
      onHealthyChange: setStreamHealthy,
      // In-place patching only holds if every frame arrived; after a gap the
      // cache is missing chunks that will never be republished.
      onResume: refetchConversation,
      onMessage: (data) => {
        let event: RunLiveEvent
        try {
          event = JSON.parse(data) as RunLiveEvent
        } catch {
          // Malformed frame — ignore; keep the socket. Polling covers gaps.
          return false
        }
        if (event.type === 'ping' || event.type === 'hello') return false
        applyFrame(event)
        return true
      },
    })

    return () => stream.close()
  }, [demo, runId, qc])

  return { streamHealthy }
}
