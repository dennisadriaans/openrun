/**
 * Resolves the bind address and access token, and enforces them.
 *
 * The rules live in `lib/serverAccess.ts` so the same logic can be reasoned
 * about (and tested) without `node:` imports. This module supplies the values
 * from the environment and disk, and is the only place that reads or writes the
 * token file.
 *
 * Server-only. Never import from a route component.
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_COOKIE_LEGACY,
  ACCESS_TOKEN_HEADER,
  ACCESS_TOKEN_HEADER_LEGACY,
  ACCESS_TOKEN_QUERY_PARAM,
  ACCESS_TOKEN_QUERY_PARAM_LEGACY,
  accessCookieHeader,
  DEFAULT_HOST,
  hostHeaderRefusal,
  insecureHostWarning,
  isDocumentRequest,
  parseAllowedHosts,
  pathAuthenticatesItself,
  serverBindRefusal,
  tokenRequiredForRequests,
  tokensMatch,
  unauthorizedMessage,
  urlWithoutAccessToken,
  type ServerAccessConfig,
} from '../lib/serverAccess.ts'
import { openrunEnv } from '../lib/openrunEnv.ts'
import { openrunHome } from './db.ts'

/** Owner read/write only. Anything wider and the token is not a secret. */
const OWNER_ONLY = 0o600

/** Interface the server binds. */
export function resolveHost(): string {
  return openrunEnv('HOST') || DEFAULT_HOST
}

function allowInsecureHost(): boolean {
  const raw = openrunEnv('ALLOW_INSECURE_HOST').toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/**
 * Memoized token, so the guard does not stat and read a file on every request.
 *
 * Rotating the token therefore needs a restart. That is the right trade: the
 * check runs on every server function call, and a credential that changes
 * under a live process is harder to reason about than one that does not.
 */
let cachedToken: { value: string | null } | null = null

/**
 * The configured access token, or `null` when there is none.
 *
 * `OPENRUN_ACCESS_TOKEN` wins. Otherwise we look for a token previously
 * written to `~/.openrun/access-token` — but we never *generate* one here.
 * Auto-generating on a loopback-only install would hand every user a secret
 * they have to manage in order to use a tool the operating system already
 * protects, and it would break `curl localhost:3000` for no gain.
 * {@link ensureAccessToken} generates on demand instead.
 */
export function resolveAccessToken(): string | null {
  if (cachedToken) return cachedToken.value

  const fromEnv = openrunEnv('ACCESS_TOKEN')
  if (fromEnv) {
    cachedToken = { value: fromEnv }
    return fromEnv
  }

  const file = accessTokenPath()
  if (!existsSync(file)) {
    cachedToken = { value: null }
    return null
  }

  const stored = readFileSync(file, 'utf8').trim()
  cachedToken = { value: stored || null }
  return cachedToken.value
}

/** Where a generated token is persisted between restarts. */
export function accessTokenPath(): string {
  return join(openrunHome(), 'access-token')
}

/**
 * Return the access token, creating and persisting one if none exists.
 *
 * Called by operators (via `pnpm token:print`) rather than on the boot path, so a
 * default loopback install never grows a credential it did not ask for.
 */
export function ensureAccessToken(): string {
  const existing = resolveAccessToken()
  if (existing) return existing

  const token = randomBytes(32).toString('hex')
  const home = openrunHome()
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })

  const file = accessTokenPath()
  writeFileSync(file, `${token}\n`, { mode: OWNER_ONLY })
  // writeFileSync's mode is ignored when the file already exists, so set it
  // explicitly — a token readable by every account on the machine is not one.
  chmodSync(file, OWNER_ONLY)

  cachedToken = { value: token }
  return token
}

/** Current access configuration, without exposing the token itself. */
export function serverAccessConfig(): ServerAccessConfig {
  return {
    host: resolveHost(),
    hasToken: resolveAccessToken() !== null,
    allowInsecureHost: allowInsecureHost(),
    allowedHosts: parseAllowedHosts(openrunEnv('ALLOWED_HOSTS')),
  }
}

/**
 * Short, non-reversible fingerprint of the active token.
 *
 * Printed at boot so an operator can confirm which token is live without the
 * value ever reaching a log file or a screen share.
 */
export function accessTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8)
}

/**
 * Warnings are printed once; the refusal itself is recomputed every time.
 *
 * Guarding the *refusal* on a flag would be a hole: the first caller would
 * throw, set the flag, and every caller after it would sail through.
 */
const announced = globalThis as unknown as { __agentopsAccessAnnounced?: boolean }

/**
 * Why the server must not serve traffic with this configuration, or `null`.
 *
 * Prints the boot banner the first time it is consulted.
 */
export function serverAccessRefusal(): string | null {
  const config = serverAccessConfig()
  const refusal = serverBindRefusal(config)

  if (!announced.__agentopsAccessAnnounced) {
    announced.__agentopsAccessAnnounced = true

    if (refusal) {
      console.error(`[security] ${refusal}`)
    } else {
      const warning = insecureHostWarning(config)
      if (warning) console.warn(`[security] ${warning}`)

      const token = config.hasToken ? resolveAccessToken() : null
      if (token) {
        console.warn(
          `[security] Access token required on every request ` +
            `(fingerprint ${accessTokenFingerprint(token)}).`,
        )
      }
    }
  }

  return refusal
}

/**
 * Refuse to start when the configuration would publish command execution to
 * the network.
 *
 * @throws when the bind address is non-loopback and nothing protects it.
 */
export function assertServerAccess(): void {
  const refusal = serverAccessRefusal()
  if (refusal) throw new Error(refusal)
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/**
 * Token presented by a request, from whichever channel could carry it.
 *
 * Header first. `EventSource` cannot set headers, so the SSE routes fall back
 * to a query parameter; the cookie exists so the browser stops appending the
 * token to URLs after the first authenticated load.
 */
function presentedToken(request: Request): string | null {
  const header =
    request.headers.get(ACCESS_TOKEN_HEADER) ?? request.headers.get(ACCESS_TOKEN_HEADER_LEGACY)
  if (header) return header.trim()

  const cookieHeader = request.headers.get('cookie')
  const cookie =
    cookieValue(cookieHeader, ACCESS_TOKEN_COOKIE) ??
    cookieValue(cookieHeader, ACCESS_TOKEN_COOKIE_LEGACY)
  if (cookie) return cookie

  try {
    const params = new URL(request.url).searchParams
    const fromQuery =
      params.get(ACCESS_TOKEN_QUERY_PARAM) ?? params.get(ACCESS_TOKEN_QUERY_PARAM_LEGACY)
    if (fromQuery) return fromQuery.trim()
  } catch {
    // A request URL we cannot parse simply has no query token.
  }

  return null
}

/** Whether the token may be marked `Secure` — i.e. this connection is HTTPS. */
function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers.get('x-forwarded-proto')
  if (forwarded) return forwarded.split(',')[0]?.trim().toLowerCase() === 'https'

  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * What the global middleware should do with a request.
 *
 * `respond` short-circuits with that exact response — a refusal, or the
 * redirect that strips the token out of the address bar. `proceed` runs the
 * handler, appending `setCookie` to whatever it returns.
 */
export type AccessDecision =
  | { kind: 'respond'; response: Response }
  | { kind: 'proceed'; setCookie: string | null }

const PROCEED: AccessDecision = { kind: 'proceed', setCookie: null }

function refuse(body: string, status: number): AccessDecision {
  return {
    kind: 'respond',
    response: new Response(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  }
}

/**
 * Whether the request may proceed, and what the browser is handed on its way.
 *
 * Applied globally in `src/start.ts`, so every server function and every API
 * route is covered by one decision rather than 71 individual ones.
 *
 * A request that authenticates by header or query parameter also *establishes*
 * the cookie. Without that step a configured token is unusable from a browser:
 * the SPA's own calls carry no header, so the first page load would be the only
 * request that ever succeeded.
 */
export function accessDecision(request: Request): AccessDecision {
  // A configuration we refused to boot under must not serve traffic either —
  // in dev, Vite has already opened the port by the time this runs.
  const bindRefusal = serverAccessRefusal()
  if (bindRefusal) return refuse(bindRefusal, 503)

  const config = serverAccessConfig()

  let pathname = '/'
  try {
    pathname = new URL(request.url).pathname
  } catch {
    // Unparseable URL: fall through and require the token.
  }

  // Signed webhook endpoints authenticate their callers themselves.
  // They are also the endpoints a third party addresses by a tunnel hostname,
  // so they sit ahead of the Host check as well as the token check.
  if (pathAuthenticatesItself(pathname)) return PROCEED

  // Runs before the token check: a rebound page is refused whether or not a
  // token is configured, and the default install has none.
  const hostRefusal = hostHeaderRefusal(config, request.headers.get('host'))
  if (hostRefusal) return refuse(hostRefusal, 403)

  if (!tokenRequiredForRequests(config)) return PROCEED

  const expected = resolveAccessToken()
  if (!expected || !tokensMatch(expected, presentedToken(request))) {
    return refuse(unauthorizedMessage(), 401)
  }

  // Already holding the cookie: nothing to hand out, nothing to clean up.
  if (cookieValue(request.headers.get('cookie'), ACCESS_TOKEN_COOKIE) === expected) return PROCEED
  if (cookieValue(request.headers.get('cookie'), ACCESS_TOKEN_COOKIE_LEGACY) === expected) {
    return { kind: 'proceed', setCookie: accessCookieHeader(expected, requestIsSecure(request)) }
  }

  const cookie = accessCookieHeader(expected, requestIsSecure(request))

  // A page load that carried the token in its URL gets bounced to a clean one,
  // so the secret does not sit in history, in the address bar, or in a Referer.
  const cleaned = urlWithoutAccessToken(request.url)
  if (cleaned && isDocumentRequest(request.method, request.headers.get('accept'))) {
    return {
      kind: 'respond',
      response: new Response(null, {
        status: 303,
        headers: { location: cleaned, 'set-cookie': cookie, 'Cache-Control': 'no-store' },
      }),
    }
  }

  return { kind: 'proceed', setCookie: cookie }
}

/**
 * Attach the token cookie to a handler's response.
 *
 * Headers are immutable on some responses (anything that came back from
 * `fetch`), so fall back to rebuilding rather than throwing inside middleware.
 */
export function withAccessCookie(response: Response, cookie: string): Response {
  try {
    response.headers.append('set-cookie', cookie)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.append('set-cookie', cookie)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
