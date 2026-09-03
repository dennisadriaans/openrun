/**
 * The link between the contract and the facade.
 *
 * `dispatch.ts` calls `core[op.core]` by name, which is a string lookup and so
 * invisible to the type checker. This test closes that hole: it reads
 * `server/core.ts` and asserts every name the registry references is really
 * exported. A descriptor pointing at a function that was renamed or removed
 * fails here, at build time, rather than as a 500 on one endpoint nobody
 * clicked yet.
 *
 * Deliberately static. Importing `core.ts` would boot the scheduler and open
 * SQLite; the point is to check the wiring, not to run the app. Same technique
 * as `lib/edition.test.ts`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { operations } from '../../contract/index.ts'
import { buildArgs, validatePayload } from './dispatch.ts'
import type { Operation } from '../../contract/index.ts'

const CORE = join(import.meta.dirname, '..', 'core.ts')

/** Every value name `server/core.ts` exports, however it is spelled. */
function coreExports(): Set<string> {
  const source = readFileSync(CORE, 'utf8')
  const names = new Set<string>()

  for (const m of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.add(m[1])
  }
  for (const m of source.matchAll(/^export\s+(?:const|let|class)\s+(\w+)/gm)) {
    names.add(m[1])
  }
  // `export { a, b as c, type D } from './x'` and the local `export { a }` form.
  for (const block of source.matchAll(/^export\s*\{([\s\S]*?)\}/gm)) {
    for (const raw of block[1].split(',')) {
      const entry = raw.trim()
      if (!entry || entry.startsWith('type ')) continue
      const alias = /(?:\w+)\s+as\s+(\w+)/.exec(entry)
      names.add(alias ? alias[1] : entry.replace(/\s.*$/, ''))
    }
  }
  return names
}

describe('contract → core wiring', () => {
  const exported = coreExports()

  it('reads a plausible export list from core.ts', () => {
    assert.ok(exported.size > 50, `only found ${exported.size} exports — parser is wrong`)
    assert.ok(exported.has('getDashboard'), 'sanity: getDashboard should be exported')
  })

  it('names an existing core export for every operation', () => {
    const missing = operations
      .filter((op) => !exported.has(op.core))
      .map((op) => `${op.id} → core.${op.core}`)
    assert.deepEqual(missing, [], `contract references core exports that do not exist`)
  })
})

/** A descriptor stands in for a real operation; no core call is made. */
function op(overrides: Partial<Operation>): Operation {
  return {
    id: 'test.op',
    fn: 'testOp',
    method: 'POST',
    path: '/api/v1/test/op',
    core: 'noop',
    args: 'payload',
    input: null,
    capability: 'test.op',
    clients: ['web'],
    ...overrides,
  }
}

describe('payload validation', () => {
  it('accepts a payload matching the declared shape', () => {
    const result = validatePayload(op({ input: { runId: 'string' } }), { runId: 'r1' })
    assert.deepEqual(result, { ok: true, data: { runId: 'r1' } })
  })

  it('refuses a payload with the wrong field type', () => {
    const result = validatePayload(op({ input: { runId: 'string' } }), { runId: 7 })
    assert.equal((result as { status: number }).status, 400)
    assert.match((result as { error: string }).error, /runId/)
  })

  it('refuses a missing required field', () => {
    const result = validatePayload(op({ input: { runId: 'string' } }), {})
    assert.equal((result as { status: number }).status, 400)
  })

  it('accepts an absent payload only when the operation allows it', () => {
    const optional = op({ input: { limit: 'number?' }, inputOptional: true })
    assert.deepEqual(validatePayload(optional, undefined), { ok: true, data: undefined })

    const required = op({ input: { limit: 'number?' } })
    assert.equal((validatePayload(required, undefined) as { status: number }).status, 400)
  })

  it('passes through an operation that declares no input', () => {
    assert.deepEqual(validatePayload(op({ input: null }), undefined), { ok: true, data: undefined })
  })

  /**
   * `lib/validate.ts` rejects prototype-polluting keys, and the contract must
   * not be a way around it — these payloads reach code that resolves working
   * directories and spawns CLIs.
   */
  it('refuses a prototype-polluting key', () => {
    // Built with JSON.parse, not a literal: an object literal treats
    // `__proto__` as the prototype setter and leaves no own property, so a
    // literal would test nothing. Over the wire the payload is parsed JSON,
    // where `__proto__` really is an own key.
    const payload = JSON.parse('{"runId":"r1","__proto__":{"polluted":true}}')
    const result = validatePayload(op({ input: { runId: 'string' } }), payload)
    assert.equal((result as { status: number }).status, 400)
    assert.match((result as { error: string }).error, /not an allowed field/)
  })
})

describe('argument building', () => {
  it('passes the whole payload', () => {
    assert.deepEqual(buildArgs(op({ args: 'payload' }), { a: 1 }), [{ a: 1 }])
  })

  it('passes nothing', () => {
    assert.deepEqual(buildArgs(op({ args: 'none' }), undefined), [])
  })

  it('spreads named fields in declared order', () => {
    const spec = op({ args: ['id', 'enabled'], input: { id: 'string', enabled: 'boolean' } })
    assert.deepEqual(buildArgs(spec, { enabled: true, id: 't1' }), ['t1', true])
  })

  it('survives an absent optional payload', () => {
    assert.deepEqual(buildArgs(op({ args: ['dir'], input: { dir: 'string?' } }), undefined), [
      undefined,
    ])
  })
})
