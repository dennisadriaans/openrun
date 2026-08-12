/**
 * Unified diff text for one path in a run's workspace.
 *
 * The path rides in the query string rather than the route so a nested path
 * needs no segment escaping.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRunFileDiff } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/diff/file')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.diff')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const path = new URL(request.url).searchParams.get('path') ?? ''
        const result = await handleRunFileDiff({ runId: params.runId, path })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
