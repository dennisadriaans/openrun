/** Stop a running run from the phone. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleCancelRun } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/cancel')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.cancel')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleCancelRun(params.runId)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
