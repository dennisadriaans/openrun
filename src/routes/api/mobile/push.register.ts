/** Store the APNs device token Apple handed the phone at launch. */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleRegisterPush, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/push/register')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = requireDeviceOp(request, 'device.push')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleRegisterPush({
          device: auth.device,
          body: await readJson(request),
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
