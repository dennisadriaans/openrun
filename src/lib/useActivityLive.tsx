/**
 * Browser-side live feed for list pages.
 *
 * Opens EventSource against `/api/activity/stream`. While healthy, dashboard
 * and run-history polling stop; on stream error they resume their timers.
 * Frames map to React Query prefixes via `activityLiveInvalidateKeys` so queue
 * depth and race-group updates do not wait for a coincidental `run_changed`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ActivityLiveEvent } from './activityLive.ts'
import { activityLiveInvalidateKeys, activityLiveStreamPath } from './activityLive.ts'

const RECONNECT_MS = 2_000
const INVALIDATE_DEBOUNCE_MS = 100

const ActivityLiveContext = createContext(false)

export function useActivityStreamHealthy(): boolean {
  return useContext(ActivityLiveContext)
}

export function ActivityLiveProvider({ children }: { children: ReactNode }) {
  const streamHealthy = useActivityLiveConnection()
  return (
    <ActivityLiveContext.Provider value={streamHealthy}>{children}</ActivityLiveContext.Provider>
  )
}

function useActivityLiveConnection(): boolean {
  const qc = useQueryClient()
  const [streamHealthy, setStreamHealthy] = useState(false)

  useEffect(() => {
    if (typeof EventSource === 'undefined') return

    let closed = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null

    let pendingKeys = new Set<string>()

    const bump = (keys: readonly string[]) => {
      if (keys.length === 0) return
      for (const key of keys) pendingKeys.add(key)
      if (invalidateTimer) clearTimeout(invalidateTimer)
      invalidateTimer = setTimeout(() => {
        const batch = [...pendingKeys]
        pendingKeys = new Set()
        for (const key of batch) {
          void qc.invalidateQueries({ queryKey: [key] })
        }
      }, INVALIDATE_DEBOUNCE_MS)
    }

    const connect = () => {
      if (closed) return
      es = new EventSource(activityLiveStreamPath())

      es.onopen = () => {
        if (!closed) setStreamHealthy(true)
      }

      es.onmessage = (msg) => {
        if (closed) return
        let event: ActivityLiveEvent
        try {
          event = JSON.parse(msg.data) as ActivityLiveEvent
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
        bump(activityLiveInvalidateKeys(event))
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
      if (invalidateTimer) clearTimeout(invalidateTimer)
      es?.close()
    }
  }, [qc])

  return streamHealthy
}
