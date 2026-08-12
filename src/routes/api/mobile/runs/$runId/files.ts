/**
 * One directory level of a run's workspace, for the phone's file browser.
 *
 * `server/files.ts` owns the path-traversal check; this shell only forwards.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRunFiles } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/files')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.files')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const dir = new URL(request.url).searchParams.get('dir') ?? ''
        const result = await handleRunFiles({ runId: params.runId, dir })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
