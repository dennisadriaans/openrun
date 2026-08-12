import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CONTROL_PLANE_CAPABILITIES,
  editionLabel,
  hasControlPlaneCapability,
  resolveEdition,
} from './edition.ts'

test('no session means the local edition even with a cloud URL', () => {
  assert.equal(resolveEdition({}), 'local')
  assert.equal(resolveEdition({ cloudUrl: 'https://cloud.example.com' }), 'local')
  assert.equal(resolveEdition({ cloudUrl: 'https://cloud.example.com', hasSession: false }), 'local')
  assert.equal(resolveEdition({ hasSession: true }), 'local')
  assert.equal(resolveEdition({ cloudUrl: '', hasSession: true }), 'local')
  assert.equal(resolveEdition({ cloudUrl: '   ', hasSession: true }), 'local')
})

test('a session plus a usable control-plane URL means connected', () => {
  assert.equal(
    resolveEdition({ cloudUrl: 'https://cloud.example.com', hasSession: true }),
    'connected',
  )
  assert.equal(resolveEdition({ cloudUrl: 'http://localhost:8080', hasSession: true }), 'connected')
  assert.equal(
    resolveEdition({ cloudUrl: '  https://cloud.example.com  ', hasSession: true }),
    'connected',
  )
})

test('a malformed cloud URL degrades to local, never to half-attached', () => {
  for (const cloudUrl of ['nonsense', 'cloud.example.com', 'ftp://x.example', '://', '/relative']) {
    assert.equal(
      resolveEdition({ cloudUrl, hasSession: true }),
      'local',
      `${cloudUrl} should fall back to the fully-working local edition`,
    )
  }
})

test('editions are labelled for humans', () => {
  assert.equal(editionLabel('local'), 'Local')
  assert.equal(editionLabel('connected'), 'Connected')
})

test('control-plane capabilities are off locally and on when connected', () => {
  for (const capability of CONTROL_PLANE_CAPABILITIES) {
    assert.equal(hasControlPlaneCapability('local', capability), false)
    assert.equal(hasControlPlaneCapability('connected', capability), true)
  }
})

// ---------------------------------------------------------------------------
// The open-core boundary, enforced rather than promised
// ---------------------------------------------------------------------------

/**
 * The README commits that every local feature is free forever. The cheapest way
 * for that to quietly stop being true is for someone to route an existing local
 * capability through the edition check. This walks the source tree and fails if
 * anything outside this module consults it.
 *
 * When the commercial plane does attach, the *new* call sites it adds should be
 * listed here explicitly, so growing the paid surface is a visible diff rather
 * than an invisible one.
 */
const ALLOWED_EDITION_CONSUMERS = new Set([
  'lib/edition.ts',
  'lib/edition.test.ts',
  'lib/cloud/edition.ts',
])

const EDITION_SYMBOLS = ['resolveEdition', 'hasControlPlaneCapability', 'CONTROL_PLANE_CAPABILITIES']

function sourceFiles(dir: string, base = dir): Array<string> {
  const found: Array<string> = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full, base))
      continue
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    if (entry.name === 'routeTree.gen.ts') continue
    found.push(full.slice(base.length + 1))
  }

  return found
}

test('no local feature is gated behind the edition', () => {
  const src = join(import.meta.dirname, '..')
  const offenders: Array<string> = []

  for (const relative of sourceFiles(src)) {
    const normalized = relative.split('\\').join('/')
    if (ALLOWED_EDITION_CONSUMERS.has(normalized)) continue

    const contents = readFileSync(join(src, relative), 'utf8')
    if (EDITION_SYMBOLS.some((symbol) => contents.includes(symbol))) {
      offenders.push(normalized)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These files consult the edition. A local feature must never depend on it — ' +
      'if this is a genuinely new control-plane surface, add it to ' +
      'ALLOWED_EDITION_CONSUMERS so the paid surface grows visibly.',
  )
})
