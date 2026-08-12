/** Automations list. Prompts are stripped — a phone cannot edit them. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleListTasks } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/tasks/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'tasks.list')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = handleListTasks()
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
