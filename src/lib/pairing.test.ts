import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  decodePairingQr,
  encodePairingQr,
  formatPairingCode,
  isPairingCodeShape,
  isPairingExpired,
  normalizePairingCode,
  validateBaseUrl,
} from './pairing.ts'

// --- codes ----------------------------------------------------------------

test('normalizing upper-cases and strips separators', () => {
  assert.equal(normalizePairingCode('a1b2-c3d4'), 'A1B2C3D4')
  assert.equal(normalizePairingCode(' a1b2 c3d4 '), 'A1B2C3D4')
})

test('normalizing folds the character pairs people misread', () => {
  assert.equal(normalizePairingCode('IL'), '11')
  assert.equal(normalizePairingCode('O'), '0')
  assert.equal(normalizePairingCode('U'), 'V')
})

test('a normalized code of the right length has valid shape', () => {
  assert.equal(isPairingCodeShape('A1B2C3D4'), true)
  assert.equal(isPairingCodeShape('A1B2C3D'), false, 'too short')
  assert.equal(isPairingCodeShape('A1B2C3D45'), false, 'too long')
  assert.equal(isPairingCodeShape('a1b2c3d4'), false, 'not normalized')
  assert.equal(isPairingCodeShape('A1B2C3DI'), false, 'I is not in the alphabet')
})

test('normalizing an ambiguous code produces a valid shape', () => {
  const typed = 'oi1u-b2c3'
  const normalized = normalizePairingCode(typed)
  assert.equal(normalized.length, PAIRING_CODE_LENGTH)
  assert.equal(isPairingCodeShape(normalized), true)
})

test('display form groups the code in fours', () => {
  assert.equal(formatPairingCode('A1B2C3D4'), 'A1B2-C3D4')
  assert.equal(formatPairingCode('SHORT'), 'SHORT', 'left alone when unexpected')
})

test('expiry is inclusive of the deadline', () => {
  const issued = 1_000_000
  const expires = issued + PAIRING_TTL_MS
  assert.equal(isPairingExpired(expires, issued), false)
  assert.equal(isPairingExpired(expires, expires - 1), false)
  assert.equal(isPairingExpired(expires, expires), true)
  assert.equal(isPairingExpired(expires, expires + 1), true)
})

// --- base URL -------------------------------------------------------------

test('a LAN http address is accepted and canonicalised to its origin', () => {
  const result = validateBaseUrl('http://192.168.1.24:3000/some/path?x=1')
  assert.deepEqual(result, { ok: true, url: 'http://192.168.1.24:3000' })
})

test('every private IPv4 range is allowed over plain http', () => {
  for (const host of [
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '127.0.0.1',
    '169.254.10.1',
  ]) {
    assert.equal(validateBaseUrl(`http://${host}:3000`).ok, true, host)
  }
})

test('localhost and .local names are allowed over plain http', () => {
  assert.equal(validateBaseUrl('http://localhost:3000').ok, true)
  assert.equal(validateBaseUrl('http://dennis-mac.local:3000').ok, true)
})

test('172.32 is public — it is outside the private range', () => {
  const result = validateBaseUrl('http://172.32.0.1:3000')
  assert.equal(result.ok, false)
})

test('plain http to a public host is refused with the ATS instruction', () => {
  const result = validateBaseUrl('http://agentops.example.com')
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.message, /iOS blocks plain HTTP to public addresses/)
})

test('https to a public host is accepted — the tunnel path', () => {
  const result = validateBaseUrl('https://box.tail1234.ts.net')
  assert.deepEqual(result, { ok: true, url: 'https://box.tail1234.ts.net' })
})

test('an empty or malformed address is refused', () => {
  assert.equal(validateBaseUrl('').ok, false)
  assert.equal(validateBaseUrl('   ').ok, false)
  assert.equal(validateBaseUrl('not a url').ok, false)
  assert.equal(validateBaseUrl('192.168.1.5:3000').ok, false, 'scheme required')
})

test('a non-http scheme is refused', () => {
  assert.equal(validateBaseUrl('ftp://192.168.1.5').ok, false)
  assert.equal(validateBaseUrl('file:///etc/passwd').ok, false)
})

test('credentials embedded in the address are refused', () => {
  const result = validateBaseUrl('http://user:pw@192.168.1.5:3000')
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.message, /username and password/)
})

// --- QR payload -----------------------------------------------------------

test('a QR payload round-trips', () => {
  const payload = { base: 'http://192.168.1.24:3000', code: 'A1B2C3D4' }
  assert.deepEqual(decodePairingQr(encodePairingQr(payload)), payload)
})

test('the agentops:// URL form decodes and normalizes the code', () => {
  const decoded = decodePairingQr(
    'agentops://pair?base=http%3A%2F%2F192.168.1.24%3A3000&code=a1b2-c3d4',
  )
  assert.deepEqual(decoded, { base: 'http://192.168.1.24:3000', code: 'A1B2C3D4' })
})

test('the openrun:// URL form decodes the same way', () => {
  const decoded = decodePairingQr(
    'openrun://pair?base=http%3A%2F%2F192.168.1.24%3A3000&code=a1b2-c3d4',
  )
  assert.deepEqual(decoded, { base: 'http://192.168.1.24:3000', code: 'A1B2C3D4' })
})

test('garbage and partial QR payloads decode to null', () => {
  assert.equal(decodePairingQr(''), null)
  assert.equal(decodePairingQr('hello'), null)
  assert.equal(decodePairingQr('{not json'), null)
  assert.equal(decodePairingQr('{"base":"http://x"}'), null, 'code missing')
  assert.equal(decodePairingQr('agentops://pair?base=http://x'), null)
})

test('the QR payload never carries a token', () => {
  const encoded = encodePairingQr({ base: 'http://192.168.1.24:3000', code: 'A1B2C3D4' })
  assert.deepEqual(Object.keys(JSON.parse(encoded)).sort(), ['base', 'code'])
})
