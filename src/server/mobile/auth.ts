/**
 * The trust boundary for `/api/mobile/**`.
 *
 * Errors are values, never thrown — same contract as
 * `server/integrations/dispatcher.ts`, so a route handler stays a thin shell
 * that turns a result into a `Response`.
 *
 * This is the app's only authenticated surface. Everything else in Open Run
 * assumes one local user on loopback; the companion control that keeps that
 * assumption true is the non-loopback guard in `vite.config.ts`.
 */
import type { DeviceRow } from '../db'
import { mobileScopeAllows, mobileScopeSummary, type MobileOp } from '../../lib/mobileScope'
import { mobileEnabled } from './config'
import { findDeviceByToken, touchDevice } from './devices'

export type MobileAuthFailure = {
  ok: false
  status: number
  body: Record<string, unknown>
}

export type MobileAuthResult = { ok: true; device: DeviceRow } | MobileAuthFailure

/**
 * 404, not 403, when the feature is off: a probe should not be able to tell
 * "Open Run with mobile disabled" from "not Open Run".
 */
const NOT_FOUND: MobileAuthFailure = {
  ok: false,
  status: 404,
  body: { error: 'Not found' },
}

const UNAUTHORIZED: MobileAuthFailure = {
  ok: false,
  status: 401,
  body: { error: 'Unauthorized' },
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1]!.trim() : ''
}

/** Authenticate the caller without checking any particular capability. */
export function requireDevice(request: Request): MobileAuthResult {
  if (!mobileEnabled()) return NOT_FOUND
  const token = bearerToken(request)
  if (!token) return UNAUTHORIZED
  const device = findDeviceByToken(token)
  if (!device) return UNAUTHORIZED
  touchDevice(device)
  return { ok: true, device }
}

/**
 * Authenticate and authorise in one step. The 403 body carries the same words
 * the desktop Devices page shows, so a client that asks for something out of
 * scope can explain it rather than reporting a bare failure.
 */
export function requireDeviceOp(request: Request, op: MobileOp): MobileAuthResult {
  const auth = requireDevice(request)
  if (!auth.ok) return auth
  if (!mobileScopeAllows(auth.device.scope, op)) {
    const summary = mobileScopeSummary(auth.device.scope)
    return {
      ok: false,
      status: 403,
      body: {
        error: 'This device is not allowed to do that.',
        op,
        allowed: summary.allowed,
        denied: summary.denied,
      },
    }
  }
  return auth
}

// ---------------------------------------------------------------------------
// Pairing rate limit
// ---------------------------------------------------------------------------

/**
 * Pairing is the one unauthenticated endpoint, so it is the one that can be
 * brute-forced. A globalThis singleton because Vite HMR re-evaluates modules
 * and a per-module Map would reset the counter on every save — the same reason
 * `scheduler.ts` and `executor.ts` do this.
 */
const g = globalThis as unknown as {
  __agentopsMobilePairAttempts?: Map<string, { count: number; resetAt: number }>
}

function attempts(): Map<string, { count: number; resetAt: number }> {
  if (!g.__agentopsMobilePairAttempts) g.__agentopsMobilePairAttempts = new Map()
  return g.__agentopsMobilePairAttempts
}

export const PAIR_ATTEMPT_LIMIT = 10
export const PAIR_ATTEMPT_WINDOW_MS = 15 * 60 * 1000

/** True when this source has burned through its attempts and must wait. */
export function pairAttemptBlocked(source: string): boolean {
  const entry = attempts().get(source)
  if (!entry) return false
  if (Date.now() >= entry.resetAt) {
    attempts().delete(source)
    return false
  }
  return entry.count >= PAIR_ATTEMPT_LIMIT
}

/** Count a failed redemption. Successes call `clearPairAttempts` instead. */
export function recordPairFailure(source: string): void {
  const now = Date.now()
  const entry = attempts().get(source)
  if (!entry || now >= entry.resetAt) {
    attempts().set(source, { count: 1, resetAt: now + PAIR_ATTEMPT_WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearPairAttempts(source: string): void {
  attempts().delete(source)
}

/**
 * Best-effort client identity for rate limiting. Behind a tunnel every request
 * can share one address, which is why the limit is per-window and generous
 * rather than a hard lockout.
 */
export function requestSource(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

export const RATE_LIMITED: MobileAuthFailure = {
  ok: false,
  status: 429,
  body: { error: 'Too many pairing attempts. Wait a few minutes and try again.' },
}

export { NOT_FOUND as MOBILE_NOT_FOUND, UNAUTHORIZED as MOBILE_UNAUTHORIZED }
