import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSettledToolStatus,
  isToolCallStatus,
  isToolKind,
  toolCallTitle,
  toolKindFromName,
} from './acp.ts'

describe('toolKindFromName', () => {
  it('maps the shell tools every CLI names differently', () => {
    for (const name of ['Bash', 'shell', 'command_execution', 'BashOutput']) {
      assert.equal(toolKindFromName(name), 'execute', name)
    }
  })

  it('maps file tools to read / edit', () => {
    assert.equal(toolKindFromName('Read'), 'read')
    assert.equal(toolKindFromName('Edit'), 'edit')
    assert.equal(toolKindFromName('Write'), 'edit')
    assert.equal(toolKindFromName('MultiEdit'), 'edit')
    assert.equal(toolKindFromName('apply_patch'), 'edit')
  })

  it('maps search and fetch tools', () => {
    assert.equal(toolKindFromName('Grep'), 'search')
    assert.equal(toolKindFromName('Glob'), 'search')
    assert.equal(toolKindFromName('WebFetch'), 'fetch')
    assert.equal(toolKindFromName('web_search'), 'fetch')
  })

  it('maps Skill / Task / Agent to think', () => {
    assert.equal(toolKindFromName('Skill'), 'think')
    assert.equal(toolKindFromName('Task'), 'think')
    assert.equal(toolKindFromName('Agent'), 'think')
  })

  it('falls back to other for anything unrecognised', () => {
    assert.equal(toolKindFromName('some_mcp_tool'), 'other')
    assert.equal(toolKindFromName('mcp__github__list'), 'other')
    assert.equal(toolKindFromName(''), 'other')
    assert.equal(toolKindFromName(undefined), 'other')
  })
})

describe('toolCallTitle', () => {
  it('joins the tool name and its detail', () => {
    assert.equal(toolCallTitle('Bash', 'pnpm test'), 'Bash · pnpm test')
  })

  it('degrades gracefully with no detail or no name', () => {
    assert.equal(toolCallTitle('Bash', ''), 'Bash')
    assert.equal(toolCallTitle(undefined, ''), 'tool')
  })
})

describe('status helpers', () => {
  it('treats completed and failed as settled', () => {
    assert.ok(isSettledToolStatus('completed'))
    assert.ok(isSettledToolStatus('failed'))
    assert.ok(!isSettledToolStatus('in_progress'))
    assert.ok(!isSettledToolStatus('pending'))
    assert.ok(!isSettledToolStatus(undefined))
  })

  it('validates protocol enums', () => {
    assert.ok(isToolCallStatus('in_progress'))
    assert.ok(!isToolCallStatus('running'))
    assert.ok(isToolKind('execute'))
    assert.ok(!isToolKind('shell'))
  })
})
