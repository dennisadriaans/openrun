/**
 * File contents for the phone's read-only code viewer.
 *
 * There is deliberately no PUT here: `core.writeWorkspaceFile` has no mobile
 * route, so a phone token cannot reach a file write.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRunFileContent } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/$runId/files/content')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'runs.files')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const path = new URL(request.url).searchParams.get('path') ?? ''
        const result = handleRunFileContent({ runId: params.runId, path })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
