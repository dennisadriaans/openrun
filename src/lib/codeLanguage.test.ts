import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  fenceTitleFromInfo,
  normalizeFenceLanguage,
  syntheticPathForLanguage,
} from './codeLanguage.ts'

test('aliases collapse onto the extension the highlighter knows', () => {
  assert.equal(normalizeFenceLanguage('typescript'), 'ts')
  assert.equal(normalizeFenceLanguage('Bash'), 'sh')
  assert.equal(normalizeFenceLanguage('language-tsx'), 'tsx')
  assert.equal(normalizeFenceLanguage(undefined), '')
})

test('the info string keeps only its first token as the language', () => {
  assert.equal(normalizeFenceLanguage('ts title="a.ts"'), 'ts')
})

test('synthetic paths carry a resolvable extension, or none at all', () => {
  assert.equal(syntheticPathForLanguage('python'), 'snippet.py')
  assert.equal(syntheticPathForLanguage('yml'), 'snippet.yaml')
  assert.equal(syntheticPathForLanguage(''), 'snippet')
  assert.equal(syntheticPathForLanguage('brainfuck'), 'snippet')
})

test('fence titles come from an attribute or a bare filename', () => {
  assert.equal(fenceTitleFromInfo('ts title="src/a.ts"'), 'src/a.ts')
  assert.equal(fenceTitleFromInfo("ts file='a.ts'"), 'a.ts')
  assert.equal(fenceTitleFromInfo('ts src/main.ts'), 'src/main.ts')
  assert.equal(fenceTitleFromInfo('ts'), null)
  assert.equal(fenceTitleFromInfo('ts twoslash'), null)
})
