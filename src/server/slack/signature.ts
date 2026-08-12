/**
 * Slack request signing (HTTP fallback path only).
 *
 * Socket Mode carries its own authentication — the websocket was opened with
 * the app token, so envelopes arriving on it are already trusted. These checks
 * exist for the `/api/slack/*` routes, which anyone on the internet can POST to
 * once the app is exposed through a tunnel.
 *
 * Mirrors `integrations/crypto.ts`: constant-time compare, and a replay window
 * so a captured request cannot be re-sent tomorrow.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Slack's own recommendation: reject anything older than five minutes. */
export const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

export type VerifySlackRequestInput = {
  rawBody: string | Buffer
  signingSecret: string
  /** `X-Slack-Signature`. */
  signature: string | null | undefined
  /** `X-Slack-Request-Timestamp`, in whole seconds. */
  timestamp: string | null | undefined
  now?: number
}

/** Why this request is not a genuine, fresh Slack delivery — or null if it is. */
export function verifySlackRequest(input: VerifySlackRequestInput): string | null {
  if (!input.signingSecret) {
    return 'No Slack signing secret is configured.'
  }
  const signature = input.signature?.trim()
  const timestamp = input.timestamp?.trim()
  if (!signature || !timestamp) return 'Missing Slack signature headers.'

  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds)) return 'Malformed Slack timestamp.'

  const now = input.now ?? Date.now()
  if (Math.abs(now - seconds * 1000) > SIGNATURE_MAX_AGE_MS) {
    return 'Slack request is outside the replay window.'
  }

  const body = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody
  const expected = `v0=${createHmac('sha256', input.signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest('hex')}`

  return safeEqual(expected, signature) ? null : 'Slack signature did not match.'
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
