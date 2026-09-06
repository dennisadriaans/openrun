import { createFileRoute } from '@tanstack/react-router'
import { resizeTerminalSession } from '#/server/terminalSessions'

export const Route = createFileRoute('/api/terminals/$sessionId/resize')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const body = (await request.json()) as { cols?: number; rows?: number }
          resizeTerminalSession(params.sessionId, body.cols, body.rows)
          return new Response(null, { status: 204 })
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
