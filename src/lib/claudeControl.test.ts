import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildControlResponse,
  buildStreamJsonUserMessage,
  parseControlRequest,
} from './claudeControl.ts'

test('parseControlRequest reads a can_use_tool request', () => {
  const obj = {
    type: 'control_request',
    request_id: 'req_1',
    request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } },
  }
  const parsed = parseControlRequest(obj)
  assert.deepEqual(parsed, {
    requestId: 'req_1',
    toolName: 'Bash',
    input: { command: 'ls' },
  })
})

test('parseControlRequest ignores non-approval lines', () => {
  assert.equal(parseControlRequest({ type: 'assistant' }), null)
  assert.equal(
    parseControlRequest({ type: 'control_request', request: { subtype: 'initialize' } }),
    null,
  )
  assert.equal(parseControlRequest({ type: 'control_request' }), null)
})

test('buildControlResponse allow carries updatedInput and a trailing newline', () => {
  const line = buildControlResponse({
    requestId: 'req_1',
    decision: 'allow',
    updatedInput: { command: 'ls -a' },
  })
  assert.ok(line.endsWith('\n'))
  const obj = JSON.parse(line)
  assert.equal(obj.type, 'control_response')
  assert.equal(obj.request_id, 'req_1')
  assert.equal(obj.response.behavior, 'allow')
  assert.deepEqual(obj.response.updatedInput, { command: 'ls -a' })
})

test('buildControlResponse deny carries a message and no updatedInput', () => {
  const obj = JSON.parse(
    buildControlResponse({ requestId: 'req_2', decision: 'deny', message: 'timed out' }),
  )
  assert.equal(obj.response.behavior, 'deny')
  assert.equal(obj.response.message, 'timed out')
  assert.equal('updatedInput' in obj.response, false)
})

test('buildControlResponse deny defaults its message', () => {
  const obj = JSON.parse(buildControlResponse({ requestId: 'r', decision: 'deny' }))
  assert.equal(typeof obj.response.message, 'string')
  assert.ok(obj.response.message.length > 0)
})

test('buildStreamJsonUserMessage wraps the prompt as a user message', () => {
  const line = buildStreamJsonUserMessage('hello')
  assert.ok(line.endsWith('\n'))
  const obj = JSON.parse(line)
  assert.equal(obj.type, 'user')
  assert.equal(obj.message.role, 'user')
  assert.deepEqual(obj.message.content, [{ type: 'text', text: 'hello' }])
})
