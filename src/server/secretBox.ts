/**
 * Local wrapping key for secrets that live in SQLite.
 *
 * The key is a 32-byte file at `~/.openrun/data-key` (0600), never a column in
 * `openrun.db`. A copy of the database without that file is ciphertext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openrunHome } from './db.ts'

const PREFIX = 'enc.v1.'
const OWNER_ONLY = 0o600
const HEX_KEY = /^[0-9a-f]{64}$/i

let cachedKey: Buffer | null = null
let cachedPath = ''

export function dataKeyPath(): string {
  return join(openrunHome(), 'data-key')
}

function loadOrCreateKey(): Buffer {
  const file = dataKeyPath()
  if (cachedKey && cachedPath === file) return cachedKey

  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim()
    if (HEX_KEY.test(hex)) {
      cachedKey = Buffer.from(hex, 'hex')
      cachedPath = file
      return cachedKey
    }
  }

  const home = openrunHome()
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
  const key = randomBytes(32)
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: OWNER_ONLY })
  chmodSync(file, OWNER_ONLY)
  cachedKey = key
  cachedPath = file
  return key
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX)
}

export function secretAad(kind: string, id: string): string {
  return `openrun.v1:${kind}:${id}`
}

export function sealString(plaintext: string, aad: string): string {
  if (!plaintext) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', loadOrCreateKey(), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64url')
}

export function revealString(stored: string, aad: string): string {
  if (!stored) return ''
  if (!isSealed(stored)) return stored
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64url')
  if (buf.length < 29) throw new Error('ciphertext is too short')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', loadOrCreateKey(), iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
