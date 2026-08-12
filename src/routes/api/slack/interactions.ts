/**
 * Slack interactivity + slash-command endpoint — the HTTP fallback.
 *
 * Button clicks arrive as a JSON blob inside a form field; slash commands
 * arrive as plain form fields. `handleSlackInteractionsRequest` tells them
 * apart. Socket Mode carries both without needing this route.
 */
import { createFileRoute } from '@tanstack/react-router'
import { handleSlackInteractionsRequest } from '#/server/slack'

export const Route = createFileRoute('/api/slack/interactions')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = Buffer.from(await request.arrayBuffer())
        const result = await handleSlackInteractionsRequest({ rawBody, headers: request.headers })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
