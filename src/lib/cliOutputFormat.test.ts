import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPlainCliOutput } from './cliOutputFormat.ts'

describe('isPlainCliOutput', () => {
  it('detects plain and text output formats', () => {
    assert.equal(isPlainCliOutput(['--prompt-file', 'x', '--output-format', 'plain']), true)
    assert.equal(isPlainCliOutput(['-p', '--output-format', 'text']), true)
    assert.equal(isPlainCliOutput(['--output-format', 'streaming-json']), false)
    assert.equal(isPlainCliOutput(['-p', '--verbose']), false)
  })
})

describe('isPlainCliOutput short flag', () => {
  it('recognises the -o form Gemini uses', () => {
    assert.equal(isPlainCliOutput(['-p', '{prompt}', '-y', '-o', 'text']), true)
    assert.equal(isPlainCliOutput(['-o', 'plain']), true)
    assert.equal(isPlainCliOutput(['-o', 'json']), false)
  })
})
