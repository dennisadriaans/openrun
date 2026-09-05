/**
 * Browser-side live feed for list pages.
 *
 * Opens an SSE connection against `/api/activity/stream` through
 * `liveStream.ts`, which owns reconnect and the heartbeat watchdog. While
 * healthy, dashboard and run-history polling stop; the moment the stream goes
 * quiet or errors they resume their timers. Frames map to React Query prefixes
 * via `activityLiveInvalidateKeys` so queue depth and race-group updates do not
 * wait for a coincidental `run_changed`.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import {
  ACTIVITY_LIVE_RESUME_KEYS,
  activityLiveInvalidateKeys,
  activityLiveStreamPath,
  needsActivityLiveStream,
  type ActivityLiveEvent,
} from './activityLive.ts'
import { openLiveStream } from './liveStream.ts'

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
  const enabled = useRouterState({
    select: (state) => needsActivityLiveStream(state.location.pathname),
  })

  useEffect(() => {
    if (!enabled) {
      setStreamHealthy(false)
      return
    }
    if (typeof EventSource === 'undefined') return

    let invalidateTimer: ReturnType<typeof setTimeout> | null = null
    let pendingKeys = new Set<string>()

    const bump = (keys: readonly (readonly string[])[]) => {
      if (keys.length === 0) return
      for (const key of keys) pendingKeys.add(key.join('\0'))
      if (invalidateTimer) clearTimeout(invalidateTimer)
      invalidateTimer = setTimeout(() => {
        const batch = [...pendingKeys]
        pendingKeys = new Set()
        for (const packed of batch) {
          void qc.invalidateQueries({ queryKey: packed.split('\0') })
        }
      }, INVALIDATE_DEBOUNCE_MS)
    }

    const stream = openLiveStream({
      id: 'activity',
      label: 'Activity',
      path: activityLiveStreamPath(),
      onHealthyChange: setStreamHealthy,
      // Frames published while the socket was down are not replayed, so a
      // reconnect refetches rather than trusting what the cache still holds.
      onResume: () => bump(ACTIVITY_LIVE_RESUME_KEYS),
      onMessage: (data) => {
        let event: ActivityLiveEvent
        try {
          event = JSON.parse(data) as ActivityLiveEvent
        } catch {
          // Malformed frame — ignore; keep the socket. Polling covers gaps.
          return false
        }
        if (event.type === 'ping' || event.type === 'hello') return false
        bump(activityLiveInvalidateKeys(event))
        return true
      },
    })

    return () => {
      stream.close()
      if (invalidateTimer) clearTimeout(invalidateTimer)
    }
  }, [enabled, qc])

  return streamHealthy
}
