import { createFileRoute } from '@tanstack/react-router'
import { writeTerminalSession } from '#/server/terminalSessions'

export const Route = createFileRoute('/api/terminals/$sessionId/input')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          const data = await request.text()
          writeTerminalSession(params.sessionId, data)
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
