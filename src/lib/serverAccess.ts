/**
 * Where the Open Run server may listen, and when a request must carry a token.
 *
 * Open Run spawns coding-agent CLIs with the user's own credentials, so anyone
 * who can reach the HTTP server can run commands as that user. The bind address
 * is therefore a security control, not a preference: loopback by default, and a
 * refusal — not a warning — when a non-loopback bind has no access token.
 *
 * Browser-safe and dependency-free like everything in `lib/`: the same rules
 * decide whether the server boots and whether a request is let through, so the
 * refusal text a user reads in the terminal is the one the guard actually
 * applied. No `node:` imports — `server/accessToken.ts` supplies the values.
 */

import { allowRemoteRequest, isMobileApiPath } from './loopback.ts'

/** Interface bound when `OPENRUN_HOST` is unset. */
export const DEFAULT_HOST = '127.0.0.1'

/** Header carrying the access token. Preferred over the query parameter. */
export const ACCESS_TOKEN_HEADER = 'x-openrun-token'

/** Pre-rebrand header; still accepted so existing scripts keep working. */
export const ACCESS_TOKEN_HEADER_LEGACY = 'x-agentops-token'

/**
 * Query parameter carrying the access token.
 *
 * `EventSource` cannot set request headers, so the two SSE routes
 * (`/api/activity/stream`, `/api/runs/$runId/stream`) have no way to send the
 * header. The parameter exists for them.
 */
export const ACCESS_TOKEN_QUERY_PARAM = 'openrun_token'

/** Pre-rebrand query parameter; still accepted and stripped from URLs. */
export const ACCESS_TOKEN_QUERY_PARAM_LEGACY = 'agentops_token'

/**
 * Header `scripts/start.ts` stamps with the socket's peer address.
 *
 * A `Request` carries no peer address, and the mobile guard needs one. The
 * production entrypoint sets this from the real socket after deleting anything
 * a client sent under the same name, so it can never be spoofed from outside.
 */
export const REMOTE_ADDRESS_HEADER = 'x-openrun-remote-address'

/** Cookie the browser gets once, so the SPA does not append a token to every URL. */
export const ACCESS_TOKEN_COOKIE = 'openrun_token'

/** Pre-rebrand cookie; still read so an already-signed-in browser keeps working. */
export const ACCESS_TOKEN_COOKIE_LEGACY = 'agentops_token'

/**
 * How long the browser keeps the token cookie.
 *
 * A year. The alternative is re-pasting a token into the address bar every
 * session, and a secret handled that often is one handled carelessly.
 */
const ACCESS_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * `Set-Cookie` value that hands the browser the token for every later request.
 *
 * This is the only channel the SPA itself can use: `EventSource` cannot set a
 * header, and server-function calls do not build their own URLs, so without
 * the cookie a configured token locks the app out of its own server.
 *
 * `HttpOnly` because nothing in the client bundle reads it — same-origin
 * `fetch` and `EventSource` attach it themselves. `Lax` rather than `Strict`
 * so a normal navigation to the app still carries it; cross-site *writes* are
 * stopped by the CSRF middleware, not by this cookie.
 */
export function accessCookieHeader(token: string, secure: boolean): string {
  const attributes = [
    `${ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${ACCESS_COOKIE_MAX_AGE_SECONDS}`,
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

/**
 * The same URL with the token query parameter stripped, or `null` if it had none.
 *
 * Returned path-relative on purpose: the `Host` header is attacker-influenced,
 * and a `Location` we rebuilt from it would echo it straight back.
 */
export function urlWithoutAccessToken(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const hadToken =
    url.searchParams.has(ACCESS_TOKEN_QUERY_PARAM) ||
    url.searchParams.has(ACCESS_TOKEN_QUERY_PARAM_LEGACY)
  if (!hadToken) return null
  url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM)
  url.searchParams.delete(ACCESS_TOKEN_QUERY_PARAM_LEGACY)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Is this the browser asking for a page, rather than the app asking for data?
 *
 * Only a page load is redirected to a clean URL. An `EventSource` reconnect
 * carries the same query parameter and has to be answered, not bounced.
 */
export function isDocumentRequest(method: string, accept: string | null | undefined): boolean {
  if (method.toUpperCase() !== 'GET') return false
  return (accept ?? '').includes('text/html')
}

/** What an unauthenticated caller is told, including how to authenticate. */
export function unauthorizedMessage(): string {
  return (
    'Unauthorized: missing or invalid Open Run access token. ' +
    'Run `pnpm token:print` to print it, then load ' +
    `/?${ACCESS_TOKEN_QUERY_PARAM}=<token> once to sign this browser in, ` +
    `or send the token as the \`${ACCESS_TOKEN_HEADER}\` header.`
  )
}

export type ServerAccessConfig = {
  /** Interface the server binds, e.g. `127.0.0.1` or `0.0.0.0`. */
  host: string
  /** Whether an access token is configured (never the token itself). */
  hasToken: boolean
  /** `OPENRUN_ALLOW_INSECURE_HOST` — bind wide open, on purpose. */
  allowInsecureHost: boolean
  /** `OPENRUN_ALLOWED_HOSTS` — extra names a request may address us by. */
  allowedHosts?: string[]
  /**
   * `AGENTOPS_MOBILE` — the companion surface is on, so a non-loopback caller
   * is confined to `/api/mobile/**`, which carries its own device token.
   */
  mobileEnabled?: boolean
}

/**
 * Is `host` an address only reachable from this machine?
 *
 * Covers `localhost`, the whole 127.0.0.0/8 block, IPv6 `::1` in its expanded
 * and bracketed forms, and IPv4-mapped loopback (`::ffff:127.0.0.1`). An empty
 * host means "unset", which resolves to {@link DEFAULT_HOST}.
 *
 * `0.0.0.0` and `::` are wildcards — they bind every interface — and are not
 * loopback no matter how the platform routes them.
 */
export function isLoopbackHost(host: string): boolean {
  let h = host.trim().toLowerCase()
  if (!h) return true

  // `[::1]` / `[::1]:3000` — strip the brackets and any port that follows.
  if (h.startsWith('[')) {
    const close = h.indexOf(']')
    if (close === -1) return false
    h = h.slice(1, close)
  }

  if (h === 'localhost' || h.endsWith('.localhost')) return true

  // IPv6 loopback, compressed or fully written out.
  if (h === '::1' || /^(?:0{1,4}:){7}0{0,3}1$/.test(h)) return true

  // IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is still the v4 address underneath.
  const mapped = h.startsWith('::ffff:') ? h.slice('::ffff:'.length) : h

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(mapped)
  if (!v4) return false

  const octets = v4.slice(1).map((part) => Number(part))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false

  // 127.0.0.0/8 — the entire block loops back.
  return octets[0] === 127
}

/**
 * Why the server must not start with this configuration, or `null` to proceed.
 *
 * Binding a non-loopback interface publishes command execution to the network.
 * We refuse rather than warn, because a warning scrolls past in a dev log and
 * the failure mode here is somebody else running code as you.
 */
export function serverBindRefusal(config: ServerAccessConfig): string | null {
  if (isLoopbackHost(config.host)) return null
  if (config.hasToken) return null
  if (config.allowInsecureHost) return null
  // The mobile surface binds wide on purpose, but every remote caller is
  // confined to `/api/mobile/**` and must present a paired device token — so
  // there is nothing here for an app-wide token to protect. This is the same
  // bargain the dev server has always made in `vite.config.ts`.
  if (config.mobileEnabled) return null

  return (
    `Refusing to bind ${config.host}: Open Run runs agent CLIs with your credentials, ` +
    `so anyone who can reach this port can run commands as you. ` +
    `Set OPENRUN_ACCESS_TOKEN (openssl rand -hex 32) to require a token, ` +
    `or unset OPENRUN_HOST to bind ${DEFAULT_HOST} only. ` +
    `OPENRUN_ALLOW_INSECURE_HOST=1 overrides this when the port is already ` +
    `protected by something else — see SECURITY.md.`
  )
}

/**
 * Text to print on every boot that is reachable off-machine, or `null`.
 *
 * Distinct from {@link serverBindRefusal}: this fires on configurations we do
 * allow but that still deserve a line in the log.
 */
export function insecureHostWarning(config: ServerAccessConfig): string | null {
  if (isLoopbackHost(config.host)) return null

  if (!config.hasToken && config.mobileEnabled && !config.allowInsecureHost) {
    return (
      `Open Run is bound to ${config.host} for the mobile companion. Only ` +
      `/api/mobile/** answers other devices, and only with a paired device token.`
    )
  }

  if (!config.hasToken && config.allowInsecureHost) {
    return (
      `Open Run is bound to ${config.host} with NO access token because ` +
      `OPENRUN_ALLOW_INSECURE_HOST is set. Anyone who can reach this port can ` +
      `run commands as you.`
    )
  }

  return (
    `Open Run is bound to ${config.host} and reachable beyond this machine. ` +
    `Requests must carry the access token; keep it secret and prefer an ` +
    `encrypted channel.`
  )
}

/**
 * Hostname a request addressed us by, port and IPv6 brackets removed.
 *
 * `null` when the header is absent or unusable — HTTP/1.1 requires `Host`, so
 * a request without one is not something we need to keep serving.
 */
export function hostnameFromHostHeader(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const raw = header.trim().toLowerCase()
  if (!raw) return null

  if (raw.startsWith('[')) {
    const close = raw.indexOf(']')
    if (close === -1) return null
    const inside = raw.slice(1, close)
    return inside || null
  }

  // A bare IPv6 literal has several colons; only a trailing `:port` is a port.
  const colons = raw.split(':').length - 1
  const name = colons === 1 ? raw.slice(0, raw.indexOf(':')) : raw
  return name || null
}

/** `OPENRUN_ALLOWED_HOSTS` as a normalized list. */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((entry) => hostnameFromHostHeader(entry))
    .filter((entry): entry is string => entry !== null)
}

/** Union of configured extra names and (when mobile is on) this machine's LAN IPs. */
export function mergeAllowedHosts(configured: string[], extra: string[]): string[] {
  const hosts = new Set(configured)
  for (const entry of extra) {
    const name = hostnameFromHostHeader(entry)
    if (name) hosts.add(name)
  }
  return [...hosts]
}

/**
 * Why a request's `Host` header disqualifies it, or `null` to let it through.
 *
 * This is the DNS-rebinding guard. A browser will not let `evil.example` read a
 * cross-origin response from `127.0.0.1`, but it will happily re-resolve
 * `evil.example` to `127.0.0.1` after the page has loaded — at which point the
 * page *is* same-origin with us by the browser's reckoning, ambient credentials
 * and all, and an origin check has nothing left to compare. The name the
 * request asked for survives that trick in the `Host` header, so that is what
 * we check.
 *
 * Only enforced for a loopback bind. A server deliberately published to a
 * network is reached by names we cannot enumerate, and that configuration
 * already requires an access token (or the explicit insecure override), which
 * a rebound page cannot obtain.
 */
export function hostHeaderRefusal(
  config: ServerAccessConfig,
  header: string | null | undefined,
): string | null {
  if (!isLoopbackHost(config.host)) return null
  if (config.allowInsecureHost) return null

  const hostname = hostnameFromHostHeader(header)
  if (hostname === null) return 'Refused: request has no usable Host header.'

  if (isLoopbackHost(hostname)) return null
  if (hostname === hostnameFromHostHeader(config.host)) return null
  if ((config.allowedHosts ?? []).includes(hostname)) return null

  return (
    `Refused: this request addressed Open Run as "${hostname}", but Open Run is ` +
    `bound to ${config.host} and only answers to a loopback name. This is the ` +
    `DNS-rebinding guard. If you are reaching Open Run through a tunnel or a ` +
    `reverse proxy, add that hostname to OPENRUN_ALLOWED_HOSTS.`
  )
}

/**
 * Why a request from another machine must be refused, or `null` to let it
 * through.
 *
 * Loopback is always allowed — the desktop browser behaves exactly as it did
 * before the mobile surface existed. A remote caller gets through only when
 * mobile is on *and* it is asking for `/api/mobile/**`, the one surface that
 * authenticates callers itself. The rule lives in `lib/loopback.ts` because
 * the Vite dev guard applies the identical decision.
 */
export function remoteRequestRefusal(
  config: ServerAccessConfig,
  request: { address: string | null | undefined; url: string | null | undefined },
): string | null {
  if (
    allowRemoteRequest({
      address: request.address,
      url: request.url,
      mobileEnabled: config.mobileEnabled === true,
    })
  ) {
    return null
  }
  return config.mobileEnabled
    ? 'Only the mobile API is reachable from other devices.'
    : 'Open Run is not accepting connections from other devices.'
}

/**
 * Whether this request authenticates itself and so does not need the app-wide
 * access token.
 *
 * `/api/mobile/**` carries a per-device bearer token with its own scopes
 * (`lib/mobileScope.ts`), enforced by `requireDeviceOp` on every handler. That
 * is a *narrower* credential than the app token, so handing the app token to a
 * phone instead would be the weaker design, not the stronger one.
 */
export function selfAuthenticatingPath(url: string | null | undefined): boolean {
  return isMobileApiPath(url)
}

/**
 * Should incoming requests be checked for a token?
 *
 * Configuring a token is taken as intent to enforce it, loopback or not — a
 * token that is set but ignored is worse than no token, because it reads as
 * protection that is not there.
 */
export function tokenRequiredForRequests(config: ServerAccessConfig): boolean {
  return config.hasToken
}

/**
 * Constant-time-ish comparison of a presented token against the expected one.
 *
 * Compares every byte regardless of where the first mismatch is, so a timing
 * signal cannot be used to guess the token character by character. Length is
 * still observable, which is fine: the token's length is not the secret.
 *
 * `lib/` is dependency-free, so this cannot use `node:crypto.timingSafeEqual`.
 */
export function tokensMatch(expected: string, provided: string | null | undefined): boolean {
  if (!expected) return false
  if (typeof provided !== 'string' || provided.length !== expected.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  }
  return diff === 0
}
