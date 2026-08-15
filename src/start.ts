/**
 * Start instance — global request middleware.
 *
 * This is the single choke point in front of *every* server function and API
 * route. Open Run spawns coding-agent CLIs with the user's own credentials, so
 * "who may call this" is one decision for the whole surface, not seventy-one
 * individual ones: a new server function in `fns/index.ts` is covered the
 * moment it is written, with nothing to remember.
 *
 * The rules live in `lib/serverAccess.ts` (browser-safe, tested); the values
 * and the enforcement live in `server/accessToken.ts`. That module is imported
 * **lazily inside `.server()`** for the same reason `fns/index.ts` does it —
 * a static import would drag `better-sqlite3` and `node:fs` into the client
 * bundle and break the build.
 */
import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

/**
 * Server functions are same-origin RPC, so a cross-site page must not be able
 * to drive them with the browser's ambient credentials. API routes are exempt
 * because the signed webhook / mobile surfaces authenticate themselves
 * (see `pathAuthenticatesItself()` and the mobile bearer token).
 */
const csrfGuard = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })

const accessGuard = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const { accessRefusalResponse } = await import('./server/accessToken.ts')

  const refusal = accessRefusalResponse(request)
  if (refusal) return refusal

  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfGuard, accessGuard],
}))
