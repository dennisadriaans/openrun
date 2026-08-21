/**
 * Where a hosted MCP server sends the browser back after the user approves.
 *
 * This is a top-level navigation from the vendor's page, so it carries the
 * `SameSite=Lax` access cookie the Open Run UI already set — the global
 * middleware in `src/start.ts` still guards it like every other route. The
 * response is a redirect back to the MCP page, which reports the outcome.
 */
import { createFileRoute } from '@tanstack/react-router'
import { completeMcpOAuth } from '#/server/mcpOAuth'

function back(params: Record<string, string>): Response {
  const query = new URLSearchParams(params).toString()
  return new Response(null, { status: 302, headers: { Location: `/mcp?${query}` } })
}

export const Route = createFileRoute('/api/mcp/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const denied = url.searchParams.get('error')
        if (denied) {
          return back({
            mcpAuthError: url.searchParams.get('error_description') ?? denied,
          })
        }
        const code = url.searchParams.get('code') ?? ''
        const state = url.searchParams.get('state') ?? ''
        if (!code || !state) return back({ mcpAuthError: 'The sign-in came back incomplete.' })

        try {
          const { name } = await completeMcpOAuth({ code, state })
          return back({ mcpConnected: name })
        } catch (err) {
          return back({ mcpAuthError: err instanceof Error ? err.message : String(err) })
        }
      },
    },
  },
})
