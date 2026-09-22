import { timingSafeEqual } from 'node:crypto'

/** Constant-time compare of two hex (or arbitrary) strings. */
export function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
