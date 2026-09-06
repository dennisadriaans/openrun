import { createFileRoute } from '@tanstack/react-router'
import { createTerminalStream } from '#/server/terminalStream'

export const Route = createFileRoute('/api/terminals/$sessionId/stream')({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        try {
          return new Response(createTerminalStream(params.sessionId, request.signal), {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          })
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 404 },
          )
        }
      },
    },
  },
})
