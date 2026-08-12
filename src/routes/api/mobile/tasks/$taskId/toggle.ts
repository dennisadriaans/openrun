/**
 * Arm or disarm an automation's schedule.
 *
 * Enable can refuse (bad cron, missing workspace, binary off PATH). That
 * refusal is the server's own — surfaced as 409 with its message rather than
 * re-derived here, so there is no second gate to drift.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleToggleTask, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/tasks/$taskId/toggle')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'tasks.toggle')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = handleToggleTask({
          taskId: params.taskId,
          body: await readJson(request),
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
