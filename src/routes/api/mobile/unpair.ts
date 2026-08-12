/** A phone retiring itself. Revokes the calling device only. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleUnpair } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/unpair')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireDeviceOp(request, 'device.unpair')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleUnpair(auth.device)
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
