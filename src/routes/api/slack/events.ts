/**
 * Slack Events API endpoint — the HTTP fallback.
 *
 * Only needed when the app is reachable from the internet through a tunnel.
 * The supported path is Socket Mode (`server/slack/socketMode.ts`), which
 * needs no public URL at all.
 */
import { createFileRoute } from '@tanstack/react-router'
import { handleSlackEventsRequest } from '#/server/slack'

export const Route = createFileRoute('/api/slack/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = Buffer.from(await request.arrayBuffer())
        const result = await handleSlackEventsRequest({ rawBody, headers: request.headers })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
