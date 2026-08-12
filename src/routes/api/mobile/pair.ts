/**
 * Exchange a short-lived pairing code for a bearer token.
 *
 * The only unauthenticated mobile endpoint, and so the only one that can be
 * brute-forced — `handlePair` rate-limits per source and returns one
 * indistinguishable 401 for every failure mode.
 */
import { createFileRoute } from '@tanstack/react-router'
import { requestSource } from '#/server/mobile/auth'
import { handlePair, readJson } from '#/server/mobile/handlers'

export const Route = createFileRoute('/api/mobile/pair')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handlePair({
          body: await readJson(request),
          source: requestSource(request),
        })
        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
