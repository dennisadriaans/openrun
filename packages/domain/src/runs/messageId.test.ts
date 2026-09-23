import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMessageId, newMessageId } from './messageId.ts'

describe('newMessageId', () => {
  it('matches the server msg_ prefix shape', () => {
    const id = newMessageId()
    assert.equal(isMessageId(id), true)
    assert.match(id, /^msg_/)
  })

  it('rejects empty, oversized, or foreign prefixes', () => {
    assert.equal(isMessageId(''), false)
    assert.equal(isMessageId('run_abc'), false)
    assert.equal(isMessageId(`msg_${'a'.repeat(40)}`), false)
  })
})
