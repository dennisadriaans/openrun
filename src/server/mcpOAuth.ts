/**
 * Running a hosted MCP server's OAuth flow on Open Run's behalf.
 *
 * Discovery → dynamic client registration → PKCE authorization code → token,
 * all against metadata the vendor publishes, so there is no client secret to
 * ship and no per-provider code. Tokens are sealed in SQLite under
 * `~/.openrun/data-key`, then copied into every CLI config as an Authorization
 * header by the ordinary shared fan-out, which is what makes one sign-in count
 * for `claude`, `codex`, `grok` and `gemini` at once.
 *
 * Rules and shapes are in `lib/mcpOAuth.ts`.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  authServerMetadataUrls,
  findAuthHeader,
  mcpOAuthRefusal,
  needsRefresh,
  protectedResourceUrls,
  withAuthHeader,
  type McpOAuthMeta,
  type McpOAuthView,
} from '../lib/mcpOAuth.ts'
import type { McpServerConfig } from '../lib/mcp.ts'
import { getDb } from './db.ts'
import { getSharedMcp, saveSharedMcpServer, type SharedWriteReport } from './mcpShared.ts'
import { isSealed, revealString, sealString, secretAad } from './secretBox.ts'

const FETCH_TIMEOUT_MS = 15_000

type OAuthRow = {
  name: string
  resource: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  revocationEndpoint: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scope: string
  accessToken: string
  refreshToken: string
  expiresAt: number
  pendingState: string
  pendingVerifier: string
  updatedAt: number
}

function revealRow(row: OAuthRow): OAuthRow {
  return {
    ...row,
    clientSecret: revealString(row.clientSecret, secretAad('mcp.clientSecret', row.name)),
    accessToken: revealString(row.accessToken, secretAad('mcp.accessToken', row.name)),
    refreshToken: revealString(row.refreshToken, secretAad('mcp.refreshToken', row.name)),
    pendingVerifier: revealString(row.pendingVerifier, secretAad('mcp.pendingVerifier', row.name)),
  }
}

function sealedRow(row: OAuthRow): OAuthRow {
  return {
    ...row,
    clientSecret: sealString(row.clientSecret, secretAad('mcp.clientSecret', row.name)),
    accessToken: sealString(row.accessToken, secretAad('mcp.accessToken', row.name)),
    refreshToken: sealString(row.refreshToken, secretAad('mcp.refreshToken', row.name)),
    pendingVerifier: sealString(row.pendingVerifier, secretAad('mcp.pendingVerifier', row.name)),
  }
}

function needsSeal(row: OAuthRow): boolean {
  return (
    Boolean(row.clientSecret && !isSealed(row.clientSecret)) ||
    Boolean(row.accessToken && !isSealed(row.accessToken)) ||
    Boolean(row.refreshToken && !isSealed(row.refreshToken)) ||
    Boolean(row.pendingVerifier && !isSealed(row.pendingVerifier))
  )
}

function writeRow(row: OAuthRow): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_oauth (name, resource, issuer, authorizationEndpoint, tokenEndpoint,
         registrationEndpoint, revocationEndpoint, clientId, clientSecret, redirectUri, scope,
         accessToken, refreshToken, expiresAt, pendingState, pendingVerifier, updatedAt)
       VALUES (@name, @resource, @issuer, @authorizationEndpoint, @tokenEndpoint,
         @registrationEndpoint, @revocationEndpoint, @clientId, @clientSecret, @redirectUri, @scope,
         @accessToken, @refreshToken, @expiresAt, @pendingState, @pendingVerifier, @updatedAt)
       ON CONFLICT(name) DO UPDATE SET
         resource = @resource, issuer = @issuer, authorizationEndpoint = @authorizationEndpoint,
         tokenEndpoint = @tokenEndpoint, registrationEndpoint = @registrationEndpoint,
         revocationEndpoint = @revocationEndpoint, clientId = @clientId,
         clientSecret = @clientSecret, redirectUri = @redirectUri, scope = @scope,
         accessToken = @accessToken, refreshToken = @refreshToken, expiresAt = @expiresAt,
         pendingState = @pendingState, pendingVerifier = @pendingVerifier, updatedAt = @updatedAt`,
    )
    .run(sealedRow(row))
}

function loadRow(raw: OAuthRow | undefined): OAuthRow | undefined {
  if (!raw) return undefined
  const row = revealRow(raw)
  if (needsSeal(raw)) writeRow(row)
  return row
}

function rows(): OAuthRow[] {
  const raw = getDb().prepare('SELECT * FROM mcp_oauth ORDER BY name').all() as OAuthRow[]
  return raw.map((row) => loadRow(row)!).filter(Boolean)
}

function rowFor(name: string): OAuthRow | undefined {
  return loadRow(
    getDb().prepare('SELECT * FROM mcp_oauth WHERE name = ?').get(name) as OAuthRow | undefined,
  )
}

function rowByState(state: string): OAuthRow | undefined {
  return loadRow(
    getDb().prepare('SELECT * FROM mcp_oauth WHERE pendingState = ?').get(state) as
      | OAuthRow
      | undefined,
  )
}

function upsert(row: Partial<OAuthRow> & { name: string }): void {
  const existing = rowFor(row.name)
  const next: OAuthRow = {
    resource: '',
    issuer: '',
    authorizationEndpoint: '',
    tokenEndpoint: '',
    registrationEndpoint: '',
    revocationEndpoint: '',
    clientId: '',
    clientSecret: '',
    redirectUri: '',
    scope: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
    pendingState: '',
    pendingVerifier: '',
    ...existing,
    ...row,
    updatedAt: Date.now(),
  }
  writeRow(next)
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}: ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${new URL(url).host} did not answer with JSON`)
  }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Ask the server who guards it, then ask that guard how to talk to it.
 *
 * A server that publishes no protected-resource document is assumed to be its
 * own authorization server, which is what the MCP spec falls back to.
 */
export async function discoverMcpOAuth(serverUrl: string): Promise<McpOAuthMeta> {
  let resource = serverUrl
  let issuers: string[] = []

  for (const probe of protectedResourceUrls(serverUrl)) {
    try {
      const doc = (await fetchJson(probe)) as Record<string, unknown>
      const list = Array.isArray(doc.authorization_servers) ? doc.authorization_servers : []
      const found = list.map(str).filter(Boolean)
      if (found.length === 0) continue
      resource = str(doc.resource) || serverUrl
      issuers = found
      break
    } catch {
      // Next candidate; the spec allows either placement.
    }
  }
  if (issuers.length === 0) issuers = [new URL(serverUrl).origin]

  const failures: string[] = []
  for (const issuer of issuers) {
    for (const probe of authServerMetadataUrls(issuer)) {
      try {
        const doc = (await fetchJson(probe)) as Record<string, unknown>
        const authorizationEndpoint = str(doc.authorization_endpoint)
        const tokenEndpoint = str(doc.token_endpoint)
        if (!authorizationEndpoint || !tokenEndpoint) continue
        return {
          resource,
          issuer: str(doc.issuer) || issuer,
          authorizationEndpoint,
          tokenEndpoint,
          registrationEndpoint: str(doc.registration_endpoint),
          revocationEndpoint: str(doc.revocation_endpoint),
          scopesSupported: Array.isArray(doc.scopes_supported)
            ? doc.scopes_supported.map(str).filter(Boolean)
            : [],
        }
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err))
      }
    }
  }
  throw new Error(
    `No OAuth metadata at ${issuers.join(', ')}. ${failures[0] ?? 'Nothing answered.'}`,
  )
}

/**
 * Register Open Run as a client (RFC 7591). These vendors all allow it, which
 * is why no client secret is configured anywhere in this repo — the id below
 * is minted per machine, per server.
 */
async function registerClient(
  meta: McpOAuthMeta,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret: string }> {
  if (!meta.registrationEndpoint) {
    throw new Error(
      `${new URL(meta.issuer).host} does not accept dynamic client registration, so Open Run cannot sign in to it.`,
    )
  }
  const doc = (await fetchJson(meta.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Open Run',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(meta.scopesSupported.length > 0 ? { scope: meta.scopesSupported.join(' ') } : {}),
    }),
  })) as Record<string, unknown>
  const clientId = str(doc.client_id)
  if (!clientId) throw new Error('The authorization server registered no client_id.')
  return { clientId, clientSecret: str(doc.client_secret) }
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function sharedServer(name: string): McpServerConfig {
  const server = getSharedMcp().servers.find((entry) => entry.server.name === name)?.server
  if (!server) throw new Error(`"${name}" is not a shared server.`)
  return server
}

/**
 * Step one: everything up to handing the browser a URL. The PKCE verifier is
 * stored with the row rather than in memory so a dev-server reload mid-flow
 * does not strand the redirect.
 */
export async function beginMcpOAuth(input: {
  name: string
  redirectUri: string
}): Promise<{ authorizeUrl: string }> {
  const server = sharedServer(input.name)
  const refusal = mcpOAuthRefusal(server, isManagedByOAuth(input.name))
  if (refusal) throw new Error(refusal)
  if (!server.url) throw new Error(`"${input.name}" has no URL to discover metadata from.`)

  const meta = await discoverMcpOAuth(server.url)
  const existing = rowFor(input.name)
  const reusable =
    existing?.clientId &&
    existing.redirectUri === input.redirectUri &&
    existing.issuer === meta.issuer
  const client = reusable
    ? { clientId: existing.clientId, clientSecret: existing.clientSecret }
    : await registerClient(meta, input.redirectUri)

  const { verifier, challenge } = pkce()
  const state = randomBytes(24).toString('base64url')
  const scope = meta.scopesSupported.join(' ')

  upsert({
    name: input.name,
    resource: meta.resource,
    issuer: meta.issuer,
    authorizationEndpoint: meta.authorizationEndpoint,
    tokenEndpoint: meta.tokenEndpoint,
    registrationEndpoint: meta.registrationEndpoint,
    revocationEndpoint: meta.revocationEndpoint,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: input.redirectUri,
    scope,
    pendingState: state,
    pendingVerifier: verifier,
  })

  const authorizeUrl = new URL(meta.authorizationEndpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', client.clientId)
  authorizeUrl.searchParams.set('redirect_uri', input.redirectUri)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('resource', meta.resource)
  if (scope) authorizeUrl.searchParams.set('scope', scope)
  return { authorizeUrl: authorizeUrl.toString() }
}

async function exchange(row: OAuthRow, body: Record<string, string>): Promise<void> {
  const form = new URLSearchParams({ client_id: row.clientId, ...body })
  if (row.clientSecret) form.set('client_secret', row.clientSecret)
  const doc = (await fetchJson(row.tokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form.toString(),
  })) as Record<string, unknown>

  const accessToken = str(doc.access_token)
  if (!accessToken) throw new Error('The authorization server returned no access token.')
  const expiresIn = typeof doc.expires_in === 'number' ? doc.expires_in : 0

  upsert({
    name: row.name,
    accessToken,
    // A refresh-token grant may legally omit a new one; keep the old.
    refreshToken: str(doc.refresh_token) || row.refreshToken,
    expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    scope: str(doc.scope) || row.scope,
    pendingState: '',
    pendingVerifier: '',
  })
}

/** Step two: the vendor sent the browser back. Trade the code for a token. */
export async function completeMcpOAuth(input: {
  state: string
  code: string
}): Promise<{ name: string; report: SharedWriteReport }> {
  const row = rowByState(input.state)
  if (!row) throw new Error('That sign-in is no longer in progress. Start it again from Open Run.')
  await exchange(row, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: row.redirectUri,
    code_verifier: row.pendingVerifier,
    resource: row.resource,
  })
  return { name: row.name, report: applyToken(row.name) }
}

/**
 * Copy the current token into the shared server and fan it out.
 *
 * `force` is right here: the entry in each CLI config is one Open Run wrote,
 * and the only thing that changed is a header it owns.
 */
function applyToken(name: string): SharedWriteReport {
  const row = rowFor(name)
  if (!row) throw new Error(`"${name}" has no stored credentials.`)
  const server = withAuthHeader(sharedServer(name), row.accessToken)
  return saveSharedMcpServer({ server, force: true })
}

/**
 * Swap a token that is at or near expiry for a fresh one.
 *
 * Returns whether anything was written, so the caller can stay quiet on the
 * common path where every token is still good.
 */
export async function refreshMcpToken(input: {
  name: string
  force?: boolean
}): Promise<{ refreshed: boolean; error?: string }> {
  const row = rowFor(input.name)
  if (!row?.accessToken) return { refreshed: false }
  if (!input.force && !needsRefresh(row.expiresAt)) return { refreshed: false }
  if (!row.refreshToken) {
    return { refreshed: false, error: `${input.name} must be connected again — no refresh token.` }
  }
  try {
    await exchange(row, {
      grant_type: 'refresh_token',
      refresh_token: row.refreshToken,
      resource: row.resource,
    })
    applyToken(input.name)
    return { refreshed: true }
  } catch (err) {
    return { refreshed: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Bring every managed token up to date. Called when the MCP page loads and
 * before a run spawns, which is what keeps the header in each CLI config live
 * without a background timer.
 */
export async function refreshMcpTokens(): Promise<{ refreshed: string[]; errors: string[] }> {
  const refreshed: string[] = []
  const errors: string[] = []
  for (const row of rows()) {
    if (!row.accessToken || !needsRefresh(row.expiresAt)) continue
    const result = await refreshMcpToken({ name: row.name })
    if (result.refreshed) refreshed.push(row.name)
    if (result.error) errors.push(`${row.name}: ${result.error}`)
  }
  return { refreshed, errors }
}

/** Forget the token, tell the vendor if it will listen, and strip the header. */
export async function disconnectMcpOAuth(input: { name: string }): Promise<SharedWriteReport> {
  const row = rowFor(input.name)
  if (row?.revocationEndpoint && row.refreshToken) {
    try {
      await fetch(row.revocationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: row.refreshToken,
          token_type_hint: 'refresh_token',
          client_id: row.clientId,
        }).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch {
      // Local state is what matters; a vendor that refuses revocation is not
      // a reason to leave a dead token in four config files.
    }
  }
  getDb().prepare('DELETE FROM mcp_oauth WHERE name = ?').run(input.name)

  const server = getSharedMcp().servers.find((entry) => entry.server.name === input.name)?.server
  if (!server) return { written: [], skipped: [] }
  return saveSharedMcpServer({ server: withAuthHeader(server, ''), force: true })
}

/** Whether Open Run put the Authorization header on this server. */
export function isManagedByOAuth(name: string): boolean {
  return Boolean(rowFor(name)?.accessToken)
}

export function mcpOAuthViews(): McpOAuthView[] {
  const now = Date.now()
  return rows().map((row) => ({
    name: row.name,
    issuer: row.issuer,
    scope: row.scope,
    expiresAt: row.expiresAt,
    state: row.accessToken
      ? row.expiresAt > 0 && row.expiresAt <= now
        ? 'expired'
        : 'connected'
      : row.pendingState
        ? 'pending'
        : 'none',
  }))
}

/**
 * A header Open Run did not write means the user pasted their own token, and
 * the OAuth control has to stay out of the way.
 */
export function mcpOAuthManagedNames(): string[] {
  return rows()
    .filter((row) => Boolean(row.accessToken) || Boolean(row.pendingState))
    .map((row) => row.name)
}

export function sharedServerHasForeignAuth(server: McpServerConfig): boolean {
  return Boolean(findAuthHeader(server)) && !isManagedByOAuth(server.name)
}

/**
 * Keep every managed token live without an async hop in the spawn path.
 *
 * The token reaches a CLI as a header in its config file, which the CLI reads
 * at startup — so it has to be fresh on disk *before* a run spawns, and for a
 * `claude` session the user starts themselves Open Run is never on that path
 * at all. A timer at well under the refresh skew covers both.
 */
const REFRESH_TICK_MS = 4 * 60 * 1000

const refresher = globalThis as unknown as { __openrunMcpTokenTimer?: NodeJS.Timeout }

export function bootMcpTokenRefresh(): void {
  if (refresher.__openrunMcpTokenTimer) return
  const tick = () => {
    void refreshMcpTokens().catch(() => {
      // A vendor that is down now is retried on the next tick; the MCP page
      // reports the error when the user is actually looking.
    })
  }
  refresher.__openrunMcpTokenTimer = setInterval(tick, REFRESH_TICK_MS)
  refresher.__openrunMcpTokenTimer.unref?.()
  tick()
}
