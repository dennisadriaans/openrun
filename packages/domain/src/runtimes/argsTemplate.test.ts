import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertArgsTemplate,
  invalidArgsTemplateMessage,
  isValidArgsTemplate,
  parseArgsTemplate,
} from './argsTemplate.ts'

describe('parseArgsTemplate', () => {
  it('accepts an empty array', () => {
    assert.deepEqual(parseArgsTemplate('[]'), [])
  })

  it('accepts a string array with tokens', () => {
    assert.deepEqual(parseArgsTemplate('["-p", "--cwd", "{cwd}", "{prompt}"]'), [
      '-p',
      '--cwd',
      '{cwd}',
      '{prompt}',
    ])
  })

  it('rejects malformed JSON', () => {
    assert.throws(() => parseArgsTemplate('[not-json'), /Invalid args template/)
  })

  it('rejects a JSON object', () => {
    assert.throws(() => parseArgsTemplate('{"flag":"-p"}'), /Invalid args template/)
  })

  it('rejects a JSON string', () => {
    assert.throws(() => parseArgsTemplate('"-p"'), /Invalid args template/)
  })

  it('rejects arrays with non-string elements', () => {
    assert.throws(() => parseArgsTemplate('["-p", 1, true]'), /Invalid args template/)
    assert.throws(() => parseArgsTemplate('["-p", null]'), /Invalid args template/)
    assert.throws(() => parseArgsTemplate('["-p", {"a":1}]'), /Invalid args template/)
  })
})

describe('isValidArgsTemplate', () => {
  it('returns true for valid templates', () => {
    assert.equal(isValidArgsTemplate('[]'), true)
    assert.equal(isValidArgsTemplate('["exec", "--json", "-"]'), true)
  })

  it('returns false for invalid templates', () => {
    assert.equal(isValidArgsTemplate('{'), false)
    assert.equal(isValidArgsTemplate('{}'), false)
    assert.equal(isValidArgsTemplate('[1]'), false)
  })
})

describe('assertArgsTemplate', () => {
  it('does not throw for a valid template', () => {
    assert.doesNotThrow(() => assertArgsTemplate('["-p"]'))
  })

  it('throws with the shared message for invalid input', () => {
    assert.throws(
      () => assertArgsTemplate('not-json'),
      (err: unknown) => {
        assert.ok(err instanceof Error)
        assert.equal(err.message, invalidArgsTemplateMessage('not-json'))
        return true
      },
    )
  })
})
