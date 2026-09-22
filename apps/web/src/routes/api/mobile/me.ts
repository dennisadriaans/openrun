/** Who this token belongs to, and what it may do. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDevice } from '@openrun/runtime/mobile/auth'
import { handleMe } from '@openrun/runtime/mobile/handlers'

export const Route = createFileRoute('/api/mobile/me')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDevice(request)
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleMe(auth.device)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
