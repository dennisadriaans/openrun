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

/** Interface bound when `AGENTOPS_HOST` is unset. */
export const DEFAULT_HOST = '127.0.0.1'

/** Header carrying the access token. Preferred over the query parameter. */
export const ACCESS_TOKEN_HEADER = 'x-agentops-token'

/**
 * Query parameter carrying the access token.
 *
 * `EventSource` cannot set request headers, so the two SSE routes
 * (`/api/activity/stream`, `/api/runs/$runId/stream`) have no way to send the
 * header. The parameter exists for them.
 */
export const ACCESS_TOKEN_QUERY_PARAM = 'agentops_token'

/** Cookie the browser gets once, so the SPA does not append a token to every URL. */
export const ACCESS_TOKEN_COOKIE = 'agentops_token'

export type ServerAccessConfig = {
  /** Interface the server binds, e.g. `127.0.0.1` or `0.0.0.0`. */
  host: string
  /** Whether an access token is configured (never the token itself). */
  hasToken: boolean
  /** `AGENTOPS_ALLOW_INSECURE_HOST` — bind wide open, on purpose. */
  allowInsecureHost: boolean
  /** `AGENTOPS_ALLOWED_HOSTS` — extra names a request may address us by. */
  allowedHosts?: string[]
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

  return (
    `Refusing to bind ${config.host}: Open Run runs agent CLIs with your credentials, ` +
    `so anyone who can reach this port can run commands as you. ` +
    `Set AGENTOPS_ACCESS_TOKEN (openssl rand -hex 32) to require a token, ` +
    `or unset AGENTOPS_HOST to bind ${DEFAULT_HOST} only. ` +
    `AGENTOPS_ALLOW_INSECURE_HOST=1 overrides this when the port is already ` +
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

  if (!config.hasToken && config.allowInsecureHost) {
    return (
      `Open Run is bound to ${config.host} with NO access token because ` +
      `AGENTOPS_ALLOW_INSECURE_HOST is set. Anyone who can reach this port can ` +
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

/** `AGENTOPS_ALLOWED_HOSTS` as a normalized list. */
export function parseAllowedHosts(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split(',')
    .map((entry) => hostnameFromHostHeader(entry))
    .filter((entry): entry is string => entry !== null)
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
    `reverse proxy, add that hostname to AGENTOPS_ALLOWED_HOSTS.`
  )
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

/**
 * Paths that authenticate a caller by their own means and must stay reachable
 * without the access token.
 *
 * Inbound webhooks are signed with a per-integration HMAC secret
 * (`server/integrations/crypto.ts`) and Slack signs its own requests. GitHub has
 * no way to add our header, so requiring the token here would simply break
 * every integration. These endpoints are not unauthenticated — they are
 * authenticated by signature instead.
 */
export function pathAuthenticatesItself(pathname: string): boolean {
  return pathname.startsWith('/api/webhooks/') || pathname.startsWith('/api/slack/')
}
