/**
 * Changed-file summary for one run — the phone's diff list.
 *
 * Read-only: this reaches `core.getRunWorkspace`, never a git write action.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRunDiff } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/diff')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.diff')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleRunDiff(params.runId)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
