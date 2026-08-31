import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyBump,
  compareSemVer,
  formatSemVer,
  highestVersion,
  parseSemVer,
  resolveBump,
  toTag,
} from './semver.ts'

test('parses plain, prefixed and prerelease versions', () => {
  assert.deepEqual(parseSemVer('1.2.3'), { major: 1, minor: 2, patch: 3 })
  assert.deepEqual(parseSemVer('v1.2.3'), { major: 1, minor: 2, patch: 3 })
  assert.deepEqual(parseSemVer('v0.1.0-beta.1'), {
    major: 0,
    minor: 1,
    patch: 0,
    prerelease: 'beta.1',
  })
  assert.deepEqual(parseSemVer('1.2.3+build.5'), { major: 1, minor: 2, patch: 3 })
})

test('rejects anything that is not a version', () => {
  for (const input of ['', 'main', '1.2', 'v1.2.3.4', 'latest', '1.2.x']) {
    assert.equal(parseSemVer(input), null, input)
  }
})

test('formats and tags', () => {
  assert.equal(formatSemVer({ major: 0, minor: 9, patch: 0 }), '0.9.0')
  assert.equal(formatSemVer({ major: 1, minor: 0, patch: 0, prerelease: 'rc.2' }), '1.0.0-rc.2')
  assert.equal(toTag({ major: 0, minor: 9, patch: 0 }), 'v0.9.0')
  assert.equal(toTag('0.9.0'), 'v0.9.0')
  assert.equal(toTag('v0.9.0'), 'v0.9.0', 'already-prefixed input is not double-prefixed')
})

test('orders versions, with prereleases below their stable release', () => {
  const sorted = ['1.0.0', '0.9.0', '1.0.0-beta.2', '1.0.0-beta.10', '0.10.0']
    .map((v) => parseSemVer(v) ?? assert.fail(v))
    .sort(compareSemVer)
    .map(formatSemVer)

  assert.deepEqual(sorted, ['0.9.0', '0.10.0', '1.0.0-beta.2', '1.0.0-beta.10', '1.0.0'])
})

test('highestVersion ignores tags that are not versions', () => {
  assert.deepEqual(highestVersion(['v0.1.0', 'nightly', 'v0.2.0', 'v0.1.9']), {
    major: 0,
    minor: 2,
    patch: 0,
  })
  assert.equal(highestVersion(['nightly', 'latest']), null)
  assert.equal(highestVersion([]), null)
})

test('applies each bump kind', () => {
  const base = { major: 1, minor: 2, patch: 3 }
  assert.equal(formatSemVer(applyBump(base, 'patch')), '1.2.4')
  assert.equal(formatSemVer(applyBump(base, 'minor')), '1.3.0')
  assert.equal(formatSemVer(applyBump(base, 'major')), '2.0.0')
})

test('bumping a prerelease promotes it to the stable release', () => {
  const beta = { major: 1, minor: 0, patch: 0, prerelease: 'beta.1' }
  assert.equal(formatSemVer(applyBump(beta, 'patch')), '1.0.0')
  assert.equal(formatSemVer(applyBump(beta, 'minor')), '1.1.0')
  assert.equal(formatSemVer(applyBump(beta, 'major')), '2.0.0')
})

test('a breaking change below 1.0 is a minor, not a jump to 1.0.0', () => {
  const resolved = resolveBump({ major: 0, minor: 8, patch: 1 }, 'major')
  assert.deepEqual(resolved, { bump: 'minor', requested: 'major', held: 'pre-1.0' })
  assert.equal(formatSemVer(applyBump({ major: 0, minor: 8, patch: 1 }, resolved.bump)), '0.9.0')
})

test('pre-1.0 holds a major even when allowMajor is set', () => {
  const resolved = resolveBump({ major: 0, minor: 8, patch: 1 }, 'major', { allowMajor: true })
  assert.equal(resolved.bump, 'minor')
  assert.equal(resolved.held, 'pre-1.0')
})

test('past 1.0 an automatic major is held by policy until opted in', () => {
  const base = { major: 1, minor: 4, patch: 0 }
  assert.deepEqual(resolveBump(base, 'major'), {
    bump: 'minor',
    requested: 'major',
    held: 'policy',
  })
  assert.deepEqual(resolveBump(base, 'major', { allowMajor: true }), {
    bump: 'major',
    requested: 'major',
    held: null,
  })
})

test('minor and patch are never held', () => {
  const base = { major: 0, minor: 8, patch: 1 }
  assert.deepEqual(resolveBump(base, 'minor'), { bump: 'minor', requested: 'minor', held: null })
  assert.deepEqual(resolveBump(base, 'patch'), { bump: 'patch', requested: 'patch', held: null })
})
