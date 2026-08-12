/** Run history, newest first. Page size is clamped server-side. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleListRuns } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'runs.list')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleListRuns(new URL(request.url))
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
