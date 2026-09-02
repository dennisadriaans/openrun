/**
 * Drift guard for the RPC surface.
 *
 * `.validator((d: { id: string }) => d)` looks like validation and is not — the
 * annotation is erased, so the arrow function is the identity and any JSON
 * reaches the handler. Every server function was written that way once. This
 * test is what stops the next one from being.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const source = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8')

/** `.validator((d: SomeType) => d)` — the identity that checks nothing. */
const IDENTITY_VALIDATOR = /\.validator\(\s*\((\w+):[\s\S]*?\)\s*=>\s*\1\s*,?\s*\)/g

/** Every `export const name = createServerFn(` declaration and its body. */
function declarations(): Array<{ name: string; body: string }> {
  const starts = [...source.matchAll(/^export const (\w+) = createServerFn/gm)]
  return starts.map((match, index) => ({
    name: match[1]!,
    body: source.slice(match.index, starts[index + 1]?.index ?? source.length),
  }))
}

describe('server function validators', () => {
  it('finds the server functions at all, so a rename cannot silently pass this', () => {
    assert.ok(declarations().length > 50, 'expected the RPC surface to be found')
  })

  it('has no identity validators left', () => {
    const offenders = [...source.matchAll(IDENTITY_VALIDATOR)].map((match) => match[0])
    assert.deepEqual(
      offenders,
      [],
      `These validators check nothing at runtime — give them a shape():\n${offenders.join('\n')}`,
    )
  })

  it('makes every declared validator actually assert a shape', () => {
    const offenders = declarations()
      .filter(({ body }) => body.includes('.validator('))
      .filter(({ body }) => !/\b(optional)?[Ss]hape\(/.test(body))
      .map(({ name }) => name)
    assert.deepEqual(
      offenders,
      [],
      `These server functions declare a validator that does not check anything: ${offenders.join(', ')}`,
    )
  })
})
