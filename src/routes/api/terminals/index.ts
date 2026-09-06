import { createFileRoute } from '@tanstack/react-router'
import { createTerminalSession } from '#/server/terminalSessions'

export const Route = createFileRoute('/api/terminals/')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            workspaceId?: string
            cols?: number
            rows?: number
          }
          const result = createTerminalSession({
            workspaceId: body.workspaceId ?? '',
            cols: body.cols,
            rows: body.rows,
          })
          return Response.json(result, { status: 201 })
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 400 },
          )
        }
      },
    },
  },
})
