/**
 * Inbound webhook endpoint for a single integration connection.
 *
 * URL shape: POST /api/webhooks/:integrationId
 * Providers verify signatures, normalize events, then the dispatcher matches
 * enabled automations and starts runs with trigger=webhook.
 */
import { createFileRoute } from '@tanstack/react-router'
import { handleWebhookRequest } from '#/server/integrations'

export const Route = createFileRoute('/api/webhooks/$integrationId')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const rawBody = Buffer.from(await request.arrayBuffer())
        const result = await handleWebhookRequest({
          integrationId: params.integrationId,
          rawBody,
          headers: request.headers,
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
