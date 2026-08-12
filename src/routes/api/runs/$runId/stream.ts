/**
 * SSE live tail for a single run.
 *
 * Browser connects with EventSource; executor publishes via `runLive` as the
 * child process writes. Polling in `useConversation` remains the fallback when
 * this stream is down.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '#/server/db'
import { createRunLiveSseStream } from '#/server/runLive'

export const Route = createFileRoute('/api/runs/$runId/stream')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const runId = params.runId
        const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
          | { status: string }
          | undefined

        if (!row) {
          return new Response('Run not found', { status: 404 })
        }

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
