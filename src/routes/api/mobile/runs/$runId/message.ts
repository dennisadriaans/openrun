/** Send a chat follow-up, resuming the run's agent session. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handlePostMessage, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/message')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.message')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = handlePostMessage({
          runId: params.runId,
          body: await readJson(request),
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
