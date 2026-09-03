/**
 * Run history, newest first (page size is clamped server-side), and starting a
 * new one.
 *
 * POST refuses with 409 and the server's own reason when the worktree is
 * missing, not ready, quarantined or already busy, when the runtime binary is
 * off PATH, or when the first message is empty — the same order
 * `lib/startChatGate.ts` mirrors for the desktop composer.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requireDeviceOp } from '#/server/mobile/auth'
import { handleListRuns, handleStartChat, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/runs/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = requireDeviceOp(request, 'runs.list')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleListRuns(new URL(request.url))
        return Response.json(result.body, { status: result.status })
      },
      POST: async ({ request }) => {
        const auth = requireDeviceOp(request, 'runs.create')
        if (!auth.ok) return Response.json(auth.body, { status: auth.status })
        const result = await handleStartChat(await readJson(request))
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
