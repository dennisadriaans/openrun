/**
 * The versioned API — every operation, one route.
 *
 * A splat rather than 118 generated route files. The contract already knows
 * the method and path of every operation, so resolution is a map lookup, and
 * `routeTree.gen.ts` grows by one entry instead of by a hundred.
 *
 * This handler does three things and nothing else: work out which client is
 * calling, read the payload, and hand both to the dispatcher. All the domain
 * logic is behind `server/core.ts`, and the refuse reasons are the gate
 * modules' own words.
 *
 * **Authentication is not done here.** The global request middleware in
 * `src/start.ts` runs `hostHeaderRefusal()` and the access-token check in
 * front of every route, this one included — "access control is one decision,
 * not seventy-one". What this file adds is *authorisation*: which surface the
 * caller is on, and whether that surface offers the operation.
 */
import { createFileRoute } from '@tanstack/react-router'

import { API_PREFIX, findOperationByRoute } from '#/contract/index'
import type { ClientId } from '#/contract/index'
import { dispatch } from '#/server/contract/dispatch'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Read the payload.
 *
 * A GET carries it as a JSON-encoded `input` query parameter — operations take
 * structured arguments, and flattening those into query fields would need a
 * second encoding convention for every client to agree on. A POST carries it
 * as a JSON body.
 *
 * A malformed payload is `undefined`, not a throw: the dispatcher's validator
 * then produces the same "invalid request" wording every other caller gets.
 */
async function readInput(request: Request, method: string): Promise<unknown> {
  if (method === 'GET') {
    const raw = new URL(request.url).searchParams.get('input')
    if (raw === null) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }
  try {
    const text = await request.text()
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

async function handle(request: Request, method: 'GET' | 'POST'): Promise<Response> {
  const path = new URL(request.url).pathname
  const op = findOperationByRoute(method, path)
  if (!op) return json({ error: 'Not found' }, 404)

  // Every caller here is on this machine.
  //
  // `allowRemoteRequest` in `lib/loopback.ts` lets a caller from another device
  // reach `/api/mobile/**` or nothing, and `selfAuthenticatingPath` exempts
  // only that surface from the app token. So a request that arrives at
  // `/api/v1/**` has already proved two things: it came from loopback, and it
  // holds the access token. That is exactly the trust a server function has.
  //
  // A paired phone therefore cannot reach this route at all, and must not be
  // handed a client id here that implies it could — it keeps using
  // `/api/mobile/**` with its scoped device token. Widening v1 to devices is a
  // deliberate security change, not a side effect of adding a route: it means
  // editing `isMobileApiPath` and `selfAuthenticatingPath`, and it would put
  // one dispatching route where nineteen narrow ones are today.
  //
  // The `mobile` entries in the contract's `clients` lists are still the truth
  // about what a phone may do — `OpenRunKit` and the contract tests read them,
  // and `server/mobile/handlers.ts` enforces the same boundary.
  const client: ClientId = request.headers.get('x-openrun-client') === 'desktop' ? 'desktop' : 'web'

  const input = await readInput(request, method)
  const result = await dispatch(op.id, input, client)

  return result.ok
    ? json(result.body ?? null, result.status)
    : json({ error: result.error }, result.status)
}

export const Route = createFileRoute('/api/v1/$')({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request, 'GET'),
      POST: async ({ request }) => handle(request, 'POST'),
    },
  },
})

/** Re-exported so a test can assert the route and the contract agree. */
export const API_V1_PREFIX = API_PREFIX
