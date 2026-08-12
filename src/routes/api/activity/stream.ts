/**
 * SSE live feed for list pages (dashboard, run history).
 *
 * Executor publishes `run_changed` when a run starts or reaches a terminal
 * status. Per-run chat/log tails remain on `/api/runs/$runId/stream`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createActivityLiveSseStream } from '#/server/activityLive'

export const Route = createFileRoute('/api/activity/stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const stream = createActivityLiveSseStream({ signal: request.signal })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        })
      },
    },
  },
})
