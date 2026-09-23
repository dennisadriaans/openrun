/**
 * "Is this request coming from this machine?"
 *
 * The remote-access guard in `vite.config.ts` is the control that keeps an
 * unauthenticated Open Run off the network when the mobile surface is enabled,
 * so the address test it depends on is worth having covered rather than
 * inlined. Kept in `lib/` (browser-safe, no `node:` imports) so the Vite config
 * — which is evaluated outside the app module graph — can import it too.
 */

/**
 * True for the forms Node reports a local peer as: plain IPv4 loopback, IPv6
 * `::1`, and the IPv4-mapped-IPv6 form a dual-stack listener produces
 * (`::ffff:127.0.0.1`), which is the one that is easy to miss.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false
  const addr = address
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '')
  if (addr === '::1') return true
  // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)
}

/** Requests a non-loopback caller may make when the mobile surface is on. */
export function isMobileApiPath(url: string | undefined | null): boolean {
  if (!url) return false
  // Node gives path + query. `//…` is protocol-relative — not a local path.
  const raw = url.split(/[?#]/, 1)[0] ?? ''
  if (!raw.startsWith('/') || raw.startsWith('//')) return false
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return false
  }
  const parts: string[] = []
  for (const part of decoded.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return false
      parts.pop()
      continue
    }
    parts.push(part)
  }
  // Prefix must be a path segment: `/api/mobile/me`, not `/api/mobile` itself
  // and not `/api/mobile/../api/runs/…` after `..` is applied.
  return parts[0] === 'api' && parts[1] === 'mobile' && parts.length >= 3
}

/**
 * The guard's decision, as one testable function.
 *
 * Loopback is always allowed — the desktop browser must behave exactly as it
 * did before this feature existed. A remote caller gets through only when the
 * feature is on *and* it is asking for the token-checked surface.
 */
export function allowRemoteRequest(input: {
  address: string | undefined | null
  url: string | undefined | null
  mobileEnabled: boolean
}): boolean {
  if (isLoopbackAddress(input.address)) return true
  if (!input.mobileEnabled) return false
  return isMobileApiPath(input.url)
}
