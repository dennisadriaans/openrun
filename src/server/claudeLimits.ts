/**
 * Claude's plan limits, read from the account rather than from disk.
 *
 * Claude records per-message tokens in `~/.claude/projects` but nothing about
 * the plan those tokens count against, so the windows on the usage page used to
 * be derived from message timestamps alone. `GET /api/oauth/usage` — the same
 * endpoint `/usage` inside Claude Code calls — returns the real ones, and costs
 * no tokens because it is a plain REST call, not inference.
 *
 * Three constraints shape everything here:
 *
 * 1. The endpoint needs the `user:profile` scope, which only a full
 *    `claude auth login` token carries. Tokens from `claude setup-token` and
 *    `CLAUDE_CODE_OAUTH_TOKEN` are inference-only, so they are never tried.
 * 2. The credential belongs to Claude Code. We read it and never refresh,
 *    rewrite, or delete it — racing its own rotation could log the user out of
 *    their CLI. An expired token is simply a miss until Claude Code renews it.
 * 3. The report is built synchronously, so callers get the last snapshot and a
 *    refresh happens behind them. A snapshot past its window is dropped rather
 *    than shown stale — a wrong "95% used" is worse than no number.
 *
 * Set `OPENRUN_CLAUDE_LIMITS=0` to switch the whole thing off.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { SESSION_WINDOW_MINUTES, WEEKLY_WINDOW_MINUTES, type UsageWindow } from '../lib/usage.ts'

const execFileAsync = promisify(execFile)

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const KEYCHAIN_SERVICE = 'Claude Code-credentials'
/** The scope `/api/oauth/usage` is gated on. */
const REQUIRED_SCOPE = 'user:profile'

const FETCH_TIMEOUT_MS = 5_000
/** Serve the snapshot without a refetch for this long. */
const FRESH_MS = 120_000
/** Past this the snapshot is dropped, so a stale reading can never gate anything. */
const MAX_AGE_MS = 60 * 60_000

const RETRY_NETWORK_MS = 60_000
const RETRY_RATE_LIMITED_MS = 15 * 60_000
/** A 401/403 means the token lacks the scope or has lapsed — a retry loop would not help. */
const RETRY_UNAUTHORIZED_MS = 6 * 60 * 60_000
const RETRY_MAX_MS = 15 * 60_000

export type ClaudeLimits = { windows: UsageWindow[]; fetchedAt: number }

type State = {
  snapshot: ClaudeLimits | null
  /** Set while a refresh is in flight so concurrent page loads fan in. */
  inFlight: Promise<void> | null
  nextAttemptAt: number
  failures: number
}

// Held on globalThis so Vite HMR doesn't reset the cache — and, more to the
// point, doesn't re-trigger the macOS Keychain prompt — on every reload.
const g = globalThis as unknown as { __openrunClaudeLimits?: State }

function state(): State {
  if (!g.__openrunClaudeLimits) {
    g.__openrunClaudeLimits = { snapshot: null, inFlight: null, nextAttemptAt: 0, failures: 0 }
  }
  return g.__openrunClaudeLimits
}

function enabled(): boolean {
  const flag = process.env.OPENRUN_CLAUDE_LIMITS?.trim()
  return flag !== '0' && flag !== 'false'
}

function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim()
  return override ? resolve(override) : join(homedir(), '.claude')
}

/**
 * The last reading, or null when there is none worth showing. Kicks off a
 * refresh when the snapshot is stale — the caller gets the current answer, the
 * next caller gets the fresh one.
 */
export function readClaudeLimits(now = Date.now()): ClaudeLimits | null {
  if (!enabled()) return null
  const s = state()
  const age = s.snapshot ? now - s.snapshot.fetchedAt : Infinity
  if (age > FRESH_MS) void refresh(now)
  if (!s.snapshot) return null
  if (age > MAX_AGE_MS) return null

  // A window whose reset has passed is describing a period that is already over.
  const live = s.snapshot.windows.filter((w) => w.resetsAt === null || w.resetsAt > now)
  return live.length ? { windows: live, fetchedAt: s.snapshot.fetchedAt } : null
}

function refresh(now: number): Promise<void> {
  const s = state()
  if (s.inFlight) return s.inFlight
  if (now < s.nextAttemptAt) return Promise.resolve()

  const run = fetchLimits()
    .then((windows) => {
      s.snapshot = { windows, fetchedAt: Date.now() }
      s.failures = 0
      s.nextAttemptAt = 0
    })
    .catch((err: unknown) => {
      s.failures += 1
      s.nextAttemptAt = Date.now() + backoffFor(err, s.failures)
      // The message never carries the token — `fetchLimits` only ever throws
      // FetchError, which is built from the status line.
      console.warn(`[usage] Claude limits unavailable: ${describe(err)}`)
    })
    .finally(() => {
      s.inFlight = null
    })

  s.inFlight = run
  return run
}

class FetchError extends Error {
  // A plain field, not a constructor parameter property: node's strip-only
  // TypeScript mode cannot compile the latter, and the test runner uses it.
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function backoffFor(err: unknown, failures: number): number {
  const status = err instanceof FetchError ? err.status : 0
  if (status === 401 || status === 403) return RETRY_UNAUTHORIZED_MS
  if (status === 429) return RETRY_RATE_LIMITED_MS
  // Nothing to authorize with, or a shape we can't read — both are steady states.
  if (status === 0 && err instanceof FetchError) return RETRY_UNAUTHORIZED_MS
  return Math.min(RETRY_MAX_MS, RETRY_NETWORK_MS * 2 ** (failures - 1))
}

function describe(err: unknown): string {
  if (err instanceof FetchError) return err.message
  return err instanceof Error ? err.message : String(err)
}

async function fetchLimits(): Promise<UsageWindow[]> {
  const token = await readAccessToken()
  if (!token) throw new FetchError('no Claude login token with the user:profile scope', 0)

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  if (!res.ok) throw new FetchError(`HTTP ${res.status}`, res.status)

  const body = (await res.json()) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new FetchError('response was not an object', 0)
  }
  const windows = toWindows(body as Record<string, unknown>)
  if (!windows.length) throw new FetchError('response carried no limit windows', 0)
  return windows
}

/** `{ utilization: 0-100, resets_at: ISO 8601 }` per bucket, as Claude Code reads it. */
const BUCKETS: Array<[key: string, id: UsageWindow['id'], label: string, minutes: number]> = [
  ['five_hour', 'session', '5-hour limit', SESSION_WINDOW_MINUTES],
  ['seven_day', 'weekly', 'Weekly limit', WEEKLY_WINDOW_MINUTES],
  ['seven_day_opus', 'weekly-opus', 'Weekly limit (Opus)', WEEKLY_WINDOW_MINUTES],
  ['seven_day_sonnet', 'weekly-sonnet', 'Weekly limit (Sonnet)', WEEKLY_WINDOW_MINUTES],
]

function toWindows(body: Record<string, unknown>): UsageWindow[] {
  const out: UsageWindow[] = []
  for (const [key, id, label, minutes] of BUCKETS) {
    const raw = body[key]
    if (!raw || typeof raw !== 'object') continue
    const bucket = raw as Record<string, unknown>
    const percent = bucket.utilization
    if (typeof percent !== 'number' || !Number.isFinite(percent)) continue
    out.push({
      id,
      label,
      windowMinutes: minutes,
      tokens: 0,
      usedPercent: Math.max(0, Math.min(100, percent)),
      startedAt: null,
      resetsAt: toEpochMs(bucket.resets_at),
      reported: true,
      tokensPerHour: null,
      projectedTokens: null,
      projectedPercent: null,
    })
  }
  return out
}

/** ISO 8601 in practice; epoch seconds accepted so a format change degrades quietly. */
function toEpochMs(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 1000)
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

type Credentials = { accessToken: string; scopes: string[]; expiresAt: number | null }

/**
 * The login token, or null when there isn't one this endpoint would accept.
 * Read fresh each time: Claude Code rotates it, and a cached copy would go
 * stale exactly when the CLI is busiest.
 */
async function readAccessToken(): Promise<string | null> {
  const creds = readCredentialsFile() ?? (await readKeychain())
  if (!creds) return null
  if (!creds.scopes.includes(REQUIRED_SCOPE)) return null
  if (creds.expiresAt !== null && creds.expiresAt <= Date.now()) return null
  return creds.accessToken || null
}

function readCredentialsFile(): Credentials | null {
  const path = join(claudeHome(), '.credentials.json')
  if (!existsSync(path)) return null
  try {
    return parseCredentials(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * macOS keeps the credential in the login Keychain instead of a file. The first
 * read shows the system's access prompt; "Always Allow" makes it silent after.
 */
async function readKeychain(): Promise<Credentials | null> {
  if (process.platform !== 'darwin') return null
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: FETCH_TIMEOUT_MS },
    )
    return parseCredentials(stdout)
  } catch {
    return null
  }
}

function parseCredentials(raw: string): Credentials | null {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const oauth = parsed.claudeAiOauth
  if (!oauth || typeof oauth !== 'object') return null
  const row = oauth as Record<string, unknown>
  const accessToken = typeof row.accessToken === 'string' ? row.accessToken : ''
  if (!accessToken) return null
  return {
    accessToken,
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s) => typeof s === 'string') : [],
    expiresAt: typeof row.expiresAt === 'number' ? row.expiresAt : null,
  }
}
