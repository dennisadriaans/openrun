/** Dashboard summary for the phone's home screen. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleDashboard } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/dashboard')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'dashboard')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleDashboard()
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
