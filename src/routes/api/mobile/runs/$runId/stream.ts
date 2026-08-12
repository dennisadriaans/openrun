/**
 * Authenticated SSE tail for one run.
 *
 * Byte-identical to `/api/runs/$runId/stream` — same builder, same unnamed
 * `data:` frames, same 15s ping — so the phone and the browser consume one
 * wire format. The only difference is the bearer check in front.
 *
 * The token rides in the `Authorization` header, not the query string: the
 * Swift client uses `URLSession.bytes`, which sets headers on a streaming
 * request, so there is no reason to put a credential somewhere it would be
 * logged by every proxy in between.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/server/db'
import { createRunLiveSseStream } from '#/server/runLive'
import { requireDeviceOp } from '#/server/mobile/auth'

export const Route = createFileRoute('/api/mobile/runs/$runId/stream')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.stream')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })

        const runId = params.runId
        const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
          | { status: string }
          | undefined
        if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

        const stream = createRunLiveSseStream(runId, {
          status: row.status,
          signal: request.signal,
        })

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
