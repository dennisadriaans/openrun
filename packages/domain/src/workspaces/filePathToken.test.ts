import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseFilePathToken, relativeToWorkspace } from './filePathToken.ts'

test('a relative path with an extension is a file reference', () => {
  assert.deepEqual(parseFilePathToken('src/lib/diff.ts'), { path: 'src/lib/diff.ts' })
  assert.deepEqual(parseFilePathToken('package.json'), { path: 'package.json' })
})

test('a trailing line (and column) is parsed off the path', () => {
  assert.deepEqual(parseFilePathToken('src/lib/diff.ts:42'), { path: 'src/lib/diff.ts', line: 42 })
  assert.deepEqual(parseFilePathToken('src/lib/diff.ts:42:9'), {
    path: 'src/lib/diff.ts',
    line: 42,
  })
})

test('extensionless project files are still references', () => {
  assert.deepEqual(parseFilePathToken('Dockerfile'), { path: 'Dockerfile' })
  assert.deepEqual(parseFilePathToken('docker/Makefile'), { path: 'docker/Makefile' })
})

test('prose, commands, identifiers and urls are not file references', () => {
  assert.equal(parseFilePathToken('pnpm test'), null)
  assert.equal(parseFilePathToken('useState'), null)
  assert.equal(parseFilePathToken('--watch'), null)
  assert.equal(parseFilePathToken('https://example.com/a.ts'), null)
  assert.equal(parseFilePathToken('www.example.com'), null)
  assert.equal(parseFilePathToken('src/lib'), null)
  assert.equal(parseFilePathToken(''), null)
})

test('absolute agent paths are accepted', () => {
  assert.deepEqual(parseFilePathToken('/Users/x/repo/src/a.tsx'), {
    path: '/Users/x/repo/src/a.tsx',
  })
})

test('relativeToWorkspace trims the root prefix only', () => {
  assert.equal(relativeToWorkspace('/repo/src/a.ts', '/repo'), 'src/a.ts')
  assert.equal(relativeToWorkspace('/other/a.ts', '/repo'), '/other/a.ts')
  assert.equal(relativeToWorkspace('src/a.ts'), 'src/a.ts')
})
