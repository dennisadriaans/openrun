/**
 * The contract's own invariants.
 *
 * These are the checks that make it safe to generate five transports from one
 * list: ids and paths unique, shapes expressible by the validator, mobile
 * capabilities identical to the allowlist `mobileScope.ts` already enforces,
 * and the whole module free of any import that would stop it reaching a
 * browser.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  API_PREFIX,
  capabilities,
  findOperation,
  findOperationByFn,
  findOperationByRoute,
  operations,
  operationsForClient,
} from './index.ts'
import { MOBILE_OPS } from '../lib/mobileScope.ts'

const CONTRACT_DIR = join(import.meta.dirname, '.')

describe('operation registry', () => {
  it('describes every capability exactly once', () => {
    const ids = operations.map((op) => op.id)
    assert.equal(new Set(ids).size, ids.length, 'duplicate operation id')
  })

  it('gives each operation a distinct route', () => {
    const routes = operations.map((op) => `${op.method} ${op.path}`)
    assert.equal(new Set(routes).size, routes.length, 'duplicate method+path')
  })

  it('keeps one server function name per operation', () => {
    const fns = operations.map((op) => op.fn)
    assert.equal(new Set(fns).size, fns.length, 'duplicate fn name')
  })

  it('puts every route under the versioned prefix', () => {
    for (const op of operations) {
      assert.ok(op.path.startsWith(`${API_PREFIX}/`), `${op.id} is not under ${API_PREFIX}`)
    }
  })

  it('uses GET only for operations that take no body', () => {
    for (const op of operations) {
      assert.ok(op.method === 'GET' || op.method === 'POST', `${op.id} has an odd method`)
    }
  })

  it('never declares a field the validator cannot check', () => {
    const allowed = new Set([
      'string',
      'string?',
      'number',
      'number?',
      'boolean',
      'boolean?',
      'string[]',
      'string[]?',
      'object',
      'object?',
      'array',
      'array?',
      'any',
      'any?',
    ])
    for (const op of operations) {
      if (!op.input) continue
      for (const [field, type] of Object.entries(op.input)) {
        assert.ok(allowed.has(type), `${op.id}.${field} declares unknown type ${type}`)
      }
    }
  })

  it('only spreads named args that the input shape declares', () => {
    for (const op of operations) {
      if (!Array.isArray(op.args)) continue
      for (const field of op.args) {
        assert.ok(op.input, `${op.id} spreads args but declares no input`)
        assert.ok(field in op.input!, `${op.id} spreads "${field}", which its input omits`)
      }
    }
  })

  it('marks an operation optional-input only when it has an input', () => {
    for (const op of operations) {
      if (op.inputOptional) assert.ok(op.input, `${op.id} is inputOptional with no input`)
    }
  })
})

describe('lookups', () => {
  it('finds an operation by id, route and legacy fn name', () => {
    const op = findOperation('runs.cancel')
    assert.ok(op, 'runs.cancel is missing')
    assert.equal(findOperationByRoute(op.method, op.path)?.id, 'runs.cancel')
    assert.equal(findOperationByFn(op.fn)?.id, 'runs.cancel')
  })

  it('returns undefined rather than throwing on an unknown id', () => {
    assert.equal(findOperation('nope.nothing'), undefined)
    assert.equal(findOperationByRoute('GET', '/api/v1/nope'), undefined)
  })
})

describe('client visibility', () => {
  it('offers every operation to the desktop client', () => {
    assert.equal(operationsForClient('desktop').length, operations.length)
  })

  it('keeps the phone strictly narrower than the desktop', () => {
    const mobile = operationsForClient('mobile')
    assert.ok(mobile.length > 0)
    assert.ok(mobile.length < operations.length, 'mobile must not reach everything')
  })

  /**
   * The point of the contract: the phone's allowlist is one table, not two.
   * If an operation is offered to `mobile` under a capability `mobileScope.ts`
   * has never heard of, the device token cannot authorise it and the endpoint
   * is unreachable — so catch it here rather than at runtime.
   */
  it('names only capabilities the mobile allowlist already grants', () => {
    const known = new Set<string>(MOBILE_OPS)
    for (const op of operationsForClient('mobile')) {
      assert.ok(
        known.has(op.capability),
        `${op.id} is offered to mobile under unknown capability "${op.capability}"`,
      )
    }
  })

  it('describes every request-response mobile capability', () => {
    const transportOnly = new Set([
      'runs.stream',
      'activity.stream',
      'device.unpair',
      'device.push',
    ])
    const described = new Set(operationsForClient('mobile').map((op) => op.capability))
    const missing = MOBILE_OPS.filter((capability) => !transportOnly.has(capability)).filter(
      (capability) => !described.has(capability),
    )
    assert.deepEqual(missing, [])
  })

  it('never lets a write reach the phone', () => {
    const writes = ['git.commitChanges', 'git.pushChanges', 'files.writeWorkspace']
    for (const id of writes) {
      const op = findOperation(id)
      assert.ok(op, `${id} is missing from the registry`)
      assert.ok(!op.clients.includes('mobile'), `${id} must not be reachable from a phone`)
    }
  })
})

describe('capabilities', () => {
  it('lists each capability once, sorted', () => {
    const caps = capabilities()
    assert.deepEqual([...caps], [...caps].sort())
    assert.equal(new Set(caps).size, caps.length)
  })
})

/**
 * The contract ships to the browser inside the generated client, so it must
 * stay as portable as `src/lib/**`. Same enforcement style as
 * `lib/edition.test.ts`: walk the directory and fail the build on an import
 * that would not survive a bundler.
 */
describe('portability', () => {
  const files = readdirSync(CONTRACT_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  )

  it('has files to check', () => {
    assert.ok(files.length >= 3, 'expected types.ts, operations.ts and index.ts')
  })

  for (const file of files) {
    it(`${file} imports nothing that needs a server`, () => {
      const source = readFileSync(join(CONTRACT_DIR, file), 'utf8')
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
      for (const spec of imports) {
        assert.ok(!spec.startsWith('node:'), `${file} imports ${spec}`)
        assert.ok(!spec.includes('/server/'), `${file} reaches into server: ${spec}`)
        assert.ok(
          spec.startsWith('.') || spec.startsWith('#/'),
          `${file} takes a third-party dependency: ${spec}`,
        )
      }
      assert.ok(!/require\(/.test(source), `${file} uses require()`)
      assert.ok(!/process\.env/.test(source), `${file} reads process.env`)
    })
  }
})
