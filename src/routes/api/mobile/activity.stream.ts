/**
 * Authenticated app-wide activity SSE — run status changes and, crucially,
 * `approval_pending` / `approval_settled`, which is how a phone sitting on the
 * runs list learns a supervised run is blocked without polling.
 *
 * Same builder and frame format as `/api/activity/stream`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createActivityLiveSseStream } from '#/server/activityLive'
import { requireDeviceOp } from '#/server/mobile/auth'

export const Route = createFileRoute('/api/mobile/activity/stream')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'activity.stream')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })

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
