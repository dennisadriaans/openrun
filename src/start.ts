/**
 * Start instance: the single choke point in front of every server function and API route.
 * Rules in `lib/serverAccess.ts`; values and enforcement in `server/accessToken.ts`, imported
 * lazily inside `.server()` so `better-sqlite3` and `node:fs` stay out of the client bundle.
 */
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

import { isClientAbort } from './lib/clientAbort.ts'
import { securityHeaders, shouldSendSecurityHeaders } from './lib/securityHeaders.ts'

// Server functions are same-origin RPC, so a cross-site page must not drive them with ambient
// credentials. API routes are exempt: the mobile surface carries its own bearer token.
const csrfGuard = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

// Reloading a page or closing an SSE tab tears the socket down mid-response.
// Nothing is left to write to, but h3 still treats the abort as an unhandled
// 500 and logs a stack, so swallow it here instead.
const abortGuard = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  try {
    return await next()
  } catch (error) {
    if (!isClientAbort(error)) throw error
    return new Response(null, { status: 499 })
  }
})

// Open Run renders a lot of text it did not write — assistant prose, command
// output, `gh` titles. React escaping is the first lock; a content policy is
// the second, and `connect-src 'self'` is the one that matters: injected script
// still cannot post your source anywhere.
const headerGuard = createMiddleware({ type: 'request' }).server(async ({ next }) => {
  const result = await next()
  const response = result.response
  if (!shouldSendSecurityHeaders(response.headers.get('content-type'))) return result

  const headers = securityHeaders({ dev: import.meta.env.DEV })
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return result
  } catch {
    // Some responses (anything returned from `fetch`) have immutable headers.
    const merged = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    return {
      ...result,
      response: new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
      }),
    }
  }
})

const accessGuard = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const { accessDecision, withAccessCookie } = await import('./server/accessToken.ts')

  const decision = accessDecision(request)
  if (decision.kind === 'respond') return decision.response

  const result = await next()
  if (!decision.setCookie) return result

  // The request proved it holds the token; hand the browser a cookie so its
  // own fetches and EventSource connections keep proving it.
  return { ...result, response: withAccessCookie(result.response, decision.setCookie) }
})

export const startInstance = createStart(() => ({
  requestMiddleware: [abortGuard, headerGuard, csrfGuard, accessGuard],
}))
