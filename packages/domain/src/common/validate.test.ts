import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { optionalShape, shape } from './validate.ts'

describe('shape', () => {
  it('hands back the value it was given', () => {
    const value = { id: 'run_1' }
    assert.equal(shape(value, { id: 'string' }), value)
  })

  it('refuses anything that is not an object', () => {
    for (const bad of [undefined, null, 'a string', 42, true, ['a']]) {
      assert.throws(() => shape(bad as never, { id: 'string' }), /Invalid request/)
    }
  })

  it('refuses a missing required field', () => {
    assert.throws(() => shape({} as never, { id: 'string' }), /"id" is required/)
    assert.throws(() => shape({ id: null } as never, { id: 'string' }), /"id" is required/)
  })

  it('refuses a field of the wrong type', () => {
    // The case that mattered: a handler that goes on to resolve a path or
    // spawn a CLI used to receive whatever JSON arrived.
    assert.throws(() => shape({ runId: { evil: true } } as never, { runId: 'string' }), /a string/)
    assert.throws(() => shape({ n: '3' } as never, { n: 'number' }), /a finite number/)
    assert.throws(() => shape({ ok: 'yes' } as never, { ok: 'boolean' }), /true or false/)
  })

  it('rejects a non-finite number', () => {
    assert.throws(() => shape({ n: Number.NaN } as never, { n: 'number' }), /a finite number/)
    assert.throws(() => shape({ n: Number.POSITIVE_INFINITY } as never, { n: 'number' }), /finite/)
  })

  it('allows an omitted optional field but still types one that is present', () => {
    assert.doesNotThrow(() => shape({} as never, { name: 'string?' }))
    assert.doesNotThrow(() => shape({ name: undefined } as never, { name: 'string?' }))
    assert.throws(() => shape({ name: 7 } as never, { name: 'string?' }), /a string/)
  })

  it('checks every entry of a string array', () => {
    assert.doesNotThrow(() => shape({ ids: ['a', 'b'] } as never, { ids: 'string[]' }))
    assert.doesNotThrow(() => shape({ ids: [] } as never, { ids: 'string[]' }))
    assert.throws(() => shape({ ids: ['a', 3] } as never, { ids: 'string[]' }), /array of strings/)
    assert.throws(() => shape({ ids: 'a' } as never, { ids: 'string[]' }), /array of strings/)
  })

  it('distinguishes an array from an object', () => {
    assert.throws(() => shape({ v: [] } as never, { v: 'object' }), /an object/)
    assert.throws(() => shape({ v: {} } as never, { v: 'array' }), /an array/)
  })

  it('refuses prototype-polluting keys outright', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const payload = JSON.parse(`{"id":"x","${key}":{"polluted":true}}`)
      assert.throws(() => shape(payload, { id: 'string' }), /not an allowed field/)
    }
  })

  it('tolerates unknown fields, so a newer client is not rejected', () => {
    assert.doesNotThrow(() => shape({ id: 'x', somethingNew: 1 } as never, { id: 'string' }))
  })

  it('accepts anything non-null for a field the domain layer owns', () => {
    assert.doesNotThrow(() => shape({ server: { a: 1 } } as never, { server: 'any' }))
    assert.throws(() => shape({} as never, { server: 'any' }), /required/)
    assert.doesNotThrow(() => shape({} as never, { server: 'any?' }))
  })
})

describe('optionalShape', () => {
  it('lets an absent payload through, for endpoints called with no argument', () => {
    assert.equal(optionalShape(undefined, { dir: 'string?' }), undefined)
    assert.equal(optionalShape(null, { dir: 'string?' }), null)
  })

  it('still checks a payload that is present', () => {
    assert.throws(() => optionalShape({ dir: 5 } as never, { dir: 'string?' }), /a string/)
  })
})
