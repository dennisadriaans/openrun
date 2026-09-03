/**
 * What a new run could be started against: the worktrees that could host one
 * and the runtimes that could drive it, each with the reason it cannot.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleStartOptions } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/start-options')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'runs.startOptions')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleStartOptions()
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
