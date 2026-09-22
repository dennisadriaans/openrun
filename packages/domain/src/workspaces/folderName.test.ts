import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertFolderName, folderNameError } from './folderName.ts'

test('accepts an ordinary folder name', () => {
  assert.equal(folderNameError('greenfield'), null)
  assert.equal(folderNameError('my-new.project_2'), null)
  assert.equal(folderNameError('  spaced  '), null)
})

test('rejects an empty or whitespace-only name', () => {
  assert.match(folderNameError('') ?? '', /required/)
  assert.match(folderNameError('   ') ?? '', /required/)
})

test('rejects dot names that would resolve outside the new folder', () => {
  assert.match(folderNameError('.') ?? '', /Invalid folder name/)
  assert.match(folderNameError('..') ?? '', /Invalid folder name/)
})

test('rejects path separators in either direction', () => {
  assert.match(folderNameError('a/b') ?? '', /path separator/)
  assert.match(folderNameError('../escape') ?? '', /path separator/)
  assert.match(folderNameError('a\\b') ?? '', /path separator/)
})

test('rejects a null byte', () => {
  assert.match(folderNameError('a\0b') ?? '', /null byte/)
})

test('assertFolderName returns the trimmed name and throws the same message', () => {
  assert.equal(assertFolderName('  greenfield '), 'greenfield')
  assert.throws(() => assertFolderName('a/b'), /path separator/)
})
