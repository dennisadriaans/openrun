/**
 * Run detail: transcript, verdict, and whatever approvals are still waiting.
 *
 * Deliberately narrower than the desktop's `getConversation` — no workspace,
 * project, sibling-workspace or model catalog, since a phone can reach none of
 * those surfaces.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleGetRun } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.read')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = handleGetRun(params.runId)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
