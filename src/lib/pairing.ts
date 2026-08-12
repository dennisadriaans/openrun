/**
 * Pairing-code shape and server base-URL rules for the mobile client.
 *
 * Browser-safe and dependency-free on purpose: the desktop pairing modal, the
 * server redemption path, and the iOS companion all have to agree on what a
 * code looks like and which base URLs can work. Keep the rejection messages
 * identical so the phone shows the same words.
 *
 * No `node:` imports: `server/mobile/devices.ts` imports this for
 * normalisation, and so does the browser.
 */

/** How long a pairing code stays redeemable. Short: it is shown on screen. */
export const PAIRING_TTL_MS = 5 * 60 * 1000

/** Characters in a pairing code, after normalisation. */
export const PAIRING_CODE_LENGTH = 8

/**
 * Crockford-style base32: no I, L, O, or U, so a code read off a screen and
 * typed into a phone cannot be ambiguous (1/I, 0/O) or spell anything.
 */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Upper-case, strip the separators people type, and fold the digit/letter
 * pairs that get misread off a screen.
 */
export function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V')
}

/** True when `value` is already normalised and the right length/alphabet. */
export function isPairingCodeShape(value: string): boolean {
  if (value.length !== PAIRING_CODE_LENGTH) return false
  for (const ch of value) {
    if (!PAIRING_ALPHABET.includes(ch)) return false
  }
  return true
}

/** Display form: two groups of four, easier to read aloud and to type. */
export function formatPairingCode(code: string): string {
  if (code.length !== PAIRING_CODE_LENGTH) return code
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** True once the code is past its TTL. */
export function isPairingExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt
}

/**
 * Private-network hosts iOS will accept over plain HTTP when the app sets
 * `NSAllowsLocalNetworking`. Anything else needs https.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local')) return true
  if (host === '::1') return true
  // IPv4 private + loopback + link-local ranges.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127 || a === 10) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 169 && b === 254) return true
    return false
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true
  return false
}

export type BaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string }

/**
 * Validate and canonicalise the server base URL a phone was given.
 *
 * The `http` + public-host rejection is not our policy — iOS App Transport
 * Security blocks that request outright, and a phone that tries it sees an
 * opaque network failure. Catching it here turns it into an instruction.
 */
export function validateBaseUrl(raw: string): BaseUrlResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, message: 'Enter the Open Run server address.' }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      ok: false,
      message: 'That is not a valid address. Include http:// or https://.',
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: 'The address must start with http:// or https://.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Remove the username and password from the address.' }
  }
  if (!parsed.hostname) {
    return { ok: false, message: 'The address is missing a host name.' }
  }
  if (parsed.protocol === 'http:' && !isPrivateHost(parsed.hostname)) {
    return {
      ok: false,
      message:
        'iOS blocks plain HTTP to public addresses; use https or a LAN address.',
    }
  }

  // Canonical form: origin only. Paths, queries and fragments are noise here —
  // every request appends its own /api/mobile/... path.
  return { ok: true, url: parsed.origin }
}

/** Payload encoded into the pairing QR code. Never contains the token. */
export type PairingQrPayload = {
  /** Server origin, already through `validateBaseUrl`. */
  base: string
  /** Short-lived, single-use code. */
  code: string
}

export function encodePairingQr(payload: PairingQrPayload): string {
  return JSON.stringify(payload)
}

/** Parse a scanned QR. Tolerates the `agentops://pair?base=…&code=…` form too. */
export function decodePairingQr(raw: string): PairingQrPayload | null {
  const text = raw.trim()
  if (!text) return null

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Partial<PairingQrPayload>
      if (typeof parsed.base === 'string' && typeof parsed.code === 'string') {
        return { base: parsed.base, code: normalizePairingCode(parsed.code) }
      }
    } catch {
      return null
    }
    return null
  }

  if (text.startsWith('agentops://')) {
    try {
      const url = new URL(text)
      const base = url.searchParams.get('base')
      const code = url.searchParams.get('code')
      if (base && code) return { base, code: normalizePairingCode(code) }
    } catch {
      return null
    }
  }
  return null
}
