/**
 * Trigger an automation now.
 *
 * Refuses with 409 and the server's own reason when the workspace is missing
 * or not ready, the runtime binary is off PATH, or the prompt is empty — the
 * same order `lib/runNowGate.ts` mirrors for the desktop Play button.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRunTaskNow } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/tasks/$taskId/run')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const auth = requireDeviceOp(request, 'tasks.runNow')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleRunTaskNow(params.taskId)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
