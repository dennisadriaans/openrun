/** Codes Node/undici use when the peer hangs up mid-request. */
const ABORT_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE'])

/** True when `error` (or anything it wraps) is a client that went away, not a real fault. */
export function isClientAbort(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    if (e instanceof Error) {
      if (e.name === 'AbortError') return true
      const code = (e as NodeJS.ErrnoException).code
      if (code && ABORT_CODES.has(code)) return true
      e = e.cause
    } else break
  }
  return false
}
