import { createFileRoute } from '@tanstack/react-router'
import { closeTerminalSession } from '#/server/terminalSessions'

export const Route = createFileRoute('/api/terminals/$sessionId/')({
  server: {
    handlers: {
      DELETE: ({ params }) => {
        closeTerminalSession(params.sessionId)
        return new Response(null, { status: 204 })
      },
    },
  },
})
