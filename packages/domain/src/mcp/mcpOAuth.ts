/**
 * OAuth for a hosted MCP server, run by Open Run rather than by each CLI.
 *
 * Servers like Stripe, Linear, Notion and Sentry hand out no static token.
 * Every CLI would otherwise run its own browser flow and keep the result in
 * its own credential store, which is four sign-ins for one server and none of
 * them visible from here. They all publish RFC 9728 protected-resource
 * metadata and RFC 8414 authorization-server metadata, they all accept
 * dynamic client registration (RFC 7591), and they all accept a plain
 * `Authorization: Bearer` header — so Open Run can do the flow once and hand
 * the token to every CLI as a header. Claude Code says as much when one is
 * set: "OAuth fallback is disabled when headers.Authorization is set."
 *
 * This module is the rules half — which URLs to probe, when a token is stale,
 * what the UI may offer. `server/mcpOAuth.ts` does the network and the DB.
 *
 * Browser-safe (the `lib/` rule).
 */
import type { McpServerConfig } from './mcp.ts'

export const MCP_AUTH_HEADER = 'Authorization'

/** Refresh this far ahead of expiry, so a run never starts on a dead token. */
export const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export type McpOAuthMeta = {
  resource: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  revocationEndpoint: string
  scopesSupported: string[]
}

/**
 * Where to look for a resource's metadata, best guess first.
 *
 * RFC 9728 inserts the well-known segment *before* the resource path, which is
 * why `https://mcp.linear.app/mcp` is described at
 * `https://mcp.linear.app/.well-known/oauth-protected-resource/mcp`. Servers
 * mounted at the root answer on the bare path instead, so both are tried.
 */
export function protectedResourceUrls(serverUrl: string): string[] {
  const url = safeUrl(serverUrl)
  if (!url) return []
  const path = url.pathname.replace(/\/+$/, '')
  const urls = [`${url.origin}/.well-known/oauth-protected-resource${path}`]
  if (path) urls.push(`${url.origin}/.well-known/oauth-protected-resource`)
  return urls
}

/**
 * The same path-aware rule for the authorization server (RFC 8414), plus the
 * OpenID variant and the naive suffix form some deployments still use.
 */
export function authServerMetadataUrls(issuer: string): string[] {
  const url = safeUrl(issuer)
  if (!url) return []
  const path = url.pathname.replace(/\/+$/, '')
  const urls = [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
  ]
  if (path) {
    urls.push(`${url.origin}${path}/.well-known/oauth-authorization-server`)
    urls.push(`${url.origin}${path}/.well-known/openid-configuration`)
    urls.push(`${url.origin}/.well-known/oauth-authorization-server`)
  }
  return urls
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Where each vendor's flow lands back in Open Run. */
export function mcpOAuthRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/mcp/oauth/callback`
}

export type McpOAuthState = 'none' | 'connected' | 'expired' | 'pending'

export type McpOAuthView = {
  name: string
  state: McpOAuthState
  issuer: string
  scope: string
  /** Epoch ms; 0 when the vendor issued a token with no stated lifetime. */
  expiresAt: number
}

export function mcpOAuthStateLabel(view: McpOAuthView): string {
  if (view.state === 'connected') return 'Connected'
  if (view.state === 'expired') return 'Session expired'
  if (view.state === 'pending') return 'Waiting for the browser…'
  return 'Not connected'
}

/** Whether a stored token should be swapped for a fresh one before use. */
export function needsRefresh(expiresAt: number, now = Date.now()): boolean {
  if (expiresAt <= 0) return false
  return expiresAt - now <= TOKEN_REFRESH_SKEW_MS
}

/**
 * Only a hosted server can be signed in, and only one Open Run is not already
 * carrying a hand-written token for.
 */
export function mcpOAuthRefusal(server: McpServerConfig, managed: boolean): string | null {
  if (server.transport === 'stdio') {
    return 'A stdio server runs as a local process — it has no OAuth endpoint to sign in to.'
  }
  if (!server.url?.trim()) return 'This server has no URL to discover metadata from.'
  const header = findAuthHeader(server)
  if (header && !managed) {
    return 'This server already carries an Authorization header you set by hand. Clear it to let Open Run manage the token.'
  }
  return null
}

/** The Authorization header on a server config, whatever its casing. */
export function findAuthHeader(server: McpServerConfig): string {
  const headers = server.headers ?? {}
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization')
  return key ? (headers[key] ?? '') : ''
}

/** The same config with Open Run's bearer token in place of any it had. */
export function withAuthHeader(server: McpServerConfig, token: string): McpServerConfig {
  const headers = { ...(server.headers ?? {}) }
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'authorization') delete headers[key]
  }
  if (token) headers[MCP_AUTH_HEADER] = `Bearer ${token}`
  const { headers: _dropped, ...rest } = server
  return { ...rest, ...(Object.keys(headers).length > 0 ? { headers } : {}) }
}

/**
 * What the UI shows in place of the token itself. The value is on the user's
 * own machine, but there is no reason for a dashboard to put it on screen.
 */
export function maskToken(token: string): string {
  if (!token) return ''
  return `${token.slice(0, 6)}…${token.slice(-4)}`
}
