import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MAX_CHECKS,
  MAX_CHECK_COMMAND_CHARS,
  assertChecks,
  parseChecks,
  serializeChecks,
  suggestChecksFromScripts,
} from './checks.ts'

describe('parseChecks', () => {
  it('returns an empty list for blank / missing values', () => {
    assert.deepEqual(parseChecks(''), [])
    assert.deepEqual(parseChecks('   '), [])
    assert.deepEqual(parseChecks(null), [])
    assert.deepEqual(parseChecks(undefined), [])
  })

  it('degrades to no checks instead of throwing on corrupt JSON', () => {
    assert.deepEqual(parseChecks('{not json'), [])
    assert.deepEqual(parseChecks('"a string"'), [])
    assert.deepEqual(parseChecks('{"command":"pnpm test"}'), [])
  })

  it('drops entries with no command', () => {
    const parsed = parseChecks(
      JSON.stringify([{ command: '  ' }, { name: 'Tests' }, { command: 'pnpm test' }]),
    )
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].command, 'pnpm test')
  })

  it('falls back to the command as the label', () => {
    const [check] = parseChecks(JSON.stringify([{ command: 'pnpm typecheck' }]))
    assert.equal(check.name, 'pnpm typecheck')
  })

  it('ignores fields retired from the definition', () => {
    const [check] = parseChecks(
      JSON.stringify([{ command: 'a', blocking: false, timeoutMs: 5_000 }]),
    )
    assert.deepEqual(Object.keys(check).sort(), ['command', 'id', 'name'])
  })

  it('caps the list at MAX_CHECKS', () => {
    const many = Array.from({ length: MAX_CHECKS + 5 }, (_, i) => ({ command: `cmd-${i}` }))
    assert.equal(parseChecks(JSON.stringify(many)).length, MAX_CHECKS)
  })

  it('round-trips through serializeChecks', () => {
    const checks = parseChecks(
      JSON.stringify([{ id: 'chk_a', name: 'Tests', command: 'pnpm test' }]),
    )
    assert.deepEqual(parseChecks(serializeChecks(checks)), checks)
  })
})

describe('assertChecks', () => {
  it('accepts an empty / missing list', () => {
    assert.deepEqual(assertChecks([]), [])
    assert.deepEqual(assertChecks(null), [])
  })

  it('rejects a non-array', () => {
    assert.throws(() => assertChecks('pnpm test'), /must be a list/)
  })

  it('rejects a check with no command', () => {
    assert.throws(() => assertChecks([{ name: 'Tests' }]), /needs a command/)
    assert.throws(() => assertChecks([{ command: '   ' }]), /needs a command/)
  })

  it('rejects an over-long command', () => {
    const command = 'x'.repeat(MAX_CHECK_COMMAND_CHARS + 1)
    assert.throws(() => assertChecks([{ command }]), /limited to/)
  })

  it('rejects more than MAX_CHECKS', () => {
    const many = Array.from({ length: MAX_CHECKS + 1 }, (_, i) => ({ command: `cmd-${i}` }))
    assert.throws(() => assertChecks(many), /at most/)
  })

  it('assigns an id when one is missing', () => {
    const [check] = assertChecks([{ command: 'pnpm test' }])
    assert.match(check.id, /^chk_/)
  })
})

describe('suggestChecksFromScripts', () => {
  it('returns nothing without scripts', () => {
    assert.deepEqual(suggestChecksFromScripts(null), [])
    assert.deepEqual(suggestChecksFromScripts({}), [])
  })

  it('proposes known scripts cheapest-first', () => {
    const suggested = suggestChecksFromScripts(
      { lint: 'eslint .', test: 'node --test', typecheck: 'tsc --noEmit' },
      'pnpm',
    )
    assert.deepEqual(
      suggested.map((c) => c.command),
      ['pnpm typecheck', 'pnpm lint', 'pnpm test'],
    )
  })

  it('does not propose `build` — slow, and typecheck already covers it', () => {
    assert.deepEqual(suggestChecksFromScripts({ build: 'vite build' }), [])
  })

  it('uses `npm run` but bare invocation for other runners', () => {
    assert.equal(suggestChecksFromScripts({ test: 'x' }, 'npm')[0].command, 'npm run test')
    assert.equal(suggestChecksFromScripts({ test: 'x' }, 'yarn')[0].command, 'yarn test')
    assert.equal(suggestChecksFromScripts({ test: 'x' }, 'bun')[0].command, 'bun test')
  })

  it('ignores non-string / empty script bodies', () => {
    assert.deepEqual(suggestChecksFromScripts({ test: '', lint: 42 as unknown as string }), [])
  })
})
