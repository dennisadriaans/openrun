/**
 * Paired-device lifecycle: mint a pairing code, redeem it for a bearer token,
 * look a device up by token, revoke.
 *
 * Credentials here are `randomBytes`, deliberately *not* the app's
 * `${prefix}_${Date.now()}${Math.random()}` id helper — that helper is fine for
 * row ids and hopeless as a secret. Only hashes are persisted, so a copy of
 * `agentops.db` yields no working credential.
 */
import { createHash, randomBytes } from 'node:crypto'

import { getDb, type DeviceRow, type DevicePairingRow } from '../db'
import { safeEqualString } from '../integrations/crypto'
import { DEFAULT_MOBILE_SCOPE, type MobileScope } from '../../lib/mobileScope'
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  isPairingCodeShape,
  isPairingExpired,
  normalizePairingCode,
} from '../../lib/pairing'

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * A pairing code drawn from the unambiguous alphabet, without modulo bias:
 * 256 % 32 === 0, so a byte maps onto the 32-character alphabet evenly.
 */
function mintCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH)
  let out = ''
  for (const byte of bytes) out += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]
  return out
}

// ---------------------------------------------------------------------------
// Pairing codes
// ---------------------------------------------------------------------------

export type PairingCode = {
  id: string
  /** Plaintext, shown once on the desktop and never stored. */
  code: string
  expiresAt: number
}

/** Mint a code for the pairing modal. Also sweeps dead rows. */
export function createPairingCode(scope: MobileScope = DEFAULT_MOBILE_SCOPE): PairingCode {
  prunePairings()
  const now = Date.now()
  const code = mintCode()
  const row: DevicePairingRow = {
    id: id('pair'),
    codeHash: sha256(code),
    scope,
    createdAt: now,
    expiresAt: now + PAIRING_TTL_MS,
    usedAt: null,
    deviceId: '',
  }
  getDb()
    .prepare(
      `INSERT INTO device_pairings (id, codeHash, scope, createdAt, expiresAt, usedAt, deviceId)
       VALUES (@id, @codeHash, @scope, @createdAt, @expiresAt, NULL, '')`,
    )
    .run(row)
  return { id: row.id, code, expiresAt: row.expiresAt }
}

/** Drop spent and expired codes; they are never useful again. */
export function prunePairings(): void {
  getDb()
    .prepare(`DELETE FROM device_pairings WHERE expiresAt < ? OR usedAt IS NOT NULL`)
    .run(Date.now())
}

/** Codes still redeemable right now — drives the modal's countdown. */
export function activePairing(): DevicePairingRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM device_pairings
       WHERE usedAt IS NULL AND expiresAt > ?
       ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(Date.now()) as DevicePairingRow | undefined
  return row ?? null
}

export function cancelPairing(pairingId: string): void {
  getDb().prepare(`DELETE FROM device_pairings WHERE id = ?`).run(pairingId)
}

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

export type RedeemResult =
  | { ok: true; token: string; device: DeviceRow }
  | { ok: false; status: number; error: string }

/**
 * Exchange a pairing code for a long-lived bearer token.
 *
 * The claim is atomic — `UPDATE … WHERE usedAt IS NULL` and then a `changes`
 * check — so two phones racing on the same code cannot both walk away with a
 * token. Every failure returns the same 401 wording: distinguishing "no such
 * code" from "expired" would let someone probe the code space.
 */
export function redeemPairingCode(input: {
  code: string
  deviceName: string
  platform?: string
}): RedeemResult {
  const code = normalizePairingCode(input.code ?? '')
  if (!isPairingCodeShape(code)) {
    return { ok: false, status: 401, error: 'That pairing code is not valid.' }
  }
  const name = (input.deviceName ?? '').trim().slice(0, 80) || 'iPhone'
  const platform = (input.platform ?? 'ios').trim().slice(0, 20) || 'ios'

  const db = getDb()
  const pairing = db
    .prepare(`SELECT * FROM device_pairings WHERE codeHash = ?`)
    .get(sha256(code)) as DevicePairingRow | undefined

  const invalid = { ok: false, status: 401, error: 'That pairing code is not valid.' } as const
  if (!pairing) return invalid
  if (pairing.usedAt !== null) return invalid
  if (isPairingExpired(pairing.expiresAt, Date.now())) return invalid

  const now = Date.now()
  const token = randomBytes(32).toString('hex')
  const device: DeviceRow = {
    id: id('dev'),
    name,
    platform,
    tokenHash: sha256(token),
    scope: pairing.scope,
    pushToken: '',
    pushEnv: '',
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  }

  // Claim first: if this loses the race, no device row is written.
  const claimed = db
    .prepare(
      `UPDATE device_pairings SET usedAt = @usedAt, deviceId = @deviceId
       WHERE id = @id AND usedAt IS NULL`,
    )
    .run({ id: pairing.id, usedAt: now, deviceId: device.id })
  if (claimed.changes !== 1) return invalid

  db.prepare(
    `INSERT INTO devices
       (id, name, platform, tokenHash, scope, pushToken, pushEnv, createdAt, lastSeenAt, revokedAt)
     VALUES
       (@id, @name, @platform, @tokenHash, @scope, '', '', @createdAt, @lastSeenAt, NULL)`,
  ).run(device)

  return { ok: true, token, device }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * Resolve a bearer token to its device, or null.
 *
 * Indexed lookup by hash rather than scanning every row. The index comparison
 * is not constant-time, but the compared value is already a SHA-256 of the
 * secret and is not invertible; `safeEqualString` then confirms the match.
 */
export function findDeviceByToken(token: string): DeviceRow | null {
  if (!token) return null
  const hash = sha256(token)
  const row = getDb().prepare(`SELECT * FROM devices WHERE tokenHash = ?`).get(hash) as
    | DeviceRow
    | undefined
  if (!row) return null
  if (row.revokedAt !== null) return null
  if (!safeEqualString(row.tokenHash, hash)) return null
  return row
}

/** How stale `lastSeenAt` may get before we spend a write on it. */
const TOUCH_INTERVAL_MS = 60_000

/**
 * Record that a device is alive. Throttled: an open SSE stream pings every 15s
 * and a run detail view polls, and none of that deserves a write per request.
 */
export function touchDevice(device: DeviceRow): void {
  const now = Date.now()
  if (device.lastSeenAt !== null && now - device.lastSeenAt < TOUCH_INTERVAL_MS) return
  getDb().prepare(`UPDATE devices SET lastSeenAt = ? WHERE id = ?`).run(now, device.id)
}

/** Paired devices, newest first. Revoked rows are kept for the audit trail. */
export function listDevices(): DeviceRow[] {
  return getDb().prepare(`SELECT * FROM devices ORDER BY createdAt DESC`).all() as DeviceRow[]
}

/** Devices that can receive an APNs push right now. */
export function pushableDevices(): DeviceRow[] {
  return getDb()
    .prepare(`SELECT * FROM devices WHERE revokedAt IS NULL AND pushToken != '' ORDER BY createdAt`)
    .all() as DeviceRow[]
}

export function getDevice(deviceId: string): DeviceRow | null {
  const row = getDb().prepare(`SELECT * FROM devices WHERE id = ?`).get(deviceId) as
    | DeviceRow
    | undefined
  return row ?? null
}

/** Register (or clear) the APNs token the phone got from Apple. */
export function registerPushToken(input: {
  deviceId: string
  pushToken: string
  pushEnv: string
}): void {
  const env = input.pushEnv === 'production' ? 'production' : 'sandbox'
  getDb()
    .prepare(`UPDATE devices SET pushToken = ?, pushEnv = ? WHERE id = ?`)
    .run(input.pushToken.trim().slice(0, 200), env, input.deviceId)
}

/**
 * Revoke a device. The token stops working immediately — every request
 * re-reads the row, so there is no session cache to invalidate.
 */
export function revokeDevice(deviceId: string): void {
  getDb()
    .prepare(`UPDATE devices SET revokedAt = ?, pushToken = '' WHERE id = ? AND revokedAt IS NULL`)
    .run(Date.now(), deviceId)
}

/** Forget a revoked device entirely. */
export function deleteDevice(deviceId: string): void {
  getDb().prepare(`DELETE FROM devices WHERE id = ?`).run(deviceId)
}
