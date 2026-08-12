/**
 * Browser-side live tail for a run detail page.
 *
 * Opens EventSource against `/api/runs/$runId/stream`. Log, turn_event, and
 * turn_started frames patch the conversation query cache in place; terminal
 * status still invalidates for a full refetch. While the stream is healthy,
 * HTTP polling stays off; on stream error it resumes 1s / 5s.
 */
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from './applyRunLiveEvent'
import type { RunLiveEvent } from './runLive'
import { runLiveStreamPath } from './runLive'

const RECONNECT_MS = 2_000

export function useRunLive(runId: string): { streamHealthy: boolean } {
  const qc = useQueryClient()
  const [streamHealthy, setStreamHealthy] = useState(false)

  useEffect(() => {
    if (typeof EventSource === 'undefined') return

    let closed = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
        } else if (result.action === 'refetch') {
          refetchConversation()
          return
        }
      } else if (event.type === 'status' || event.type === 'turn_started') {
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

    const connect = () => {
      if (closed) return
      es = new EventSource(runLiveStreamPath(runId))

      es.onopen = () => {
        if (!closed) setStreamHealthy(true)
      }

      es.onmessage = (msg) => {
        if (closed) return
        let event: RunLiveEvent
        try {
          event = JSON.parse(msg.data) as RunLiveEvent
        } catch {
          // Malformed frame — ignore; keep the socket. Polling covers gaps.
          return
        }
        if (event.type === 'ping') return
        if (event.type === 'hello') {
          setStreamHealthy(true)
          return
        }
        setStreamHealthy(true)
        applyFrame(event)
      }

      es.onerror = () => {
        setStreamHealthy(false)
        es?.close()
        es = null
        if (closed) return
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectTimer = setTimeout(connect, RECONNECT_MS)
      }
    }

    connect()

    return () => {
      closed = true
      setStreamHealthy(false)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [runId, qc])

  return { streamHealthy }
}
