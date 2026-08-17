import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** Generate a signing secret for a webhook this machine hosts itself. */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

export function hmacSha256Hex(secret: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

/** Constant-time compare of two hex (or arbitrary) strings. */
export function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verify `sha256=<hex>` signatures (GitHub X-Hub-Signature-256, Jira X-Hub-Signature).
 */
export function verifySha256PrefixedSignature(
  secret: string,
  rawBody: string | Buffer,
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue || !secret) return false
  const expected = `sha256=${hmacSha256Hex(secret, rawBody)}`
  return safeEqualString(expected, headerValue.trim())
}

/** Verify Linear's hex HMAC in `Linear-Signature` (no prefix). */
export function verifyHexHmacSignature(
  secret: string,
  rawBody: string | Buffer,
  headerValue: string | null | undefined,
): boolean {
  if (!headerValue || !secret) return false
  const expected = hmacSha256Hex(secret, rawBody)
  return safeEqualString(expected, headerValue.trim())
}
