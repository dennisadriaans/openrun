import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_TRANSPORT,
  acpLaunchPresetFor,
  acpTransportRefusal,
  isAcpTransport,
  parseTransport,
} from './acpTransport.ts'

describe('parseTransport', () => {
  it('defaults everything unknown to the CLI transport', () => {
    assert.equal(parseTransport(undefined), 'cli')
    assert.equal(parseTransport(null), 'cli')
    assert.equal(parseTransport(''), 'cli')
    assert.equal(parseTransport('nonsense'), 'cli')
    assert.equal(DEFAULT_TRANSPORT, 'cli')
  })

  it('recognises acp', () => {
    assert.equal(parseTransport('acp'), 'acp')
    assert.ok(isAcpTransport('acp'))
    assert.ok(!isAcpTransport('cli'))
  })
})

describe('acpTransportRefusal', () => {
  it('says nothing about CLI runtimes', () => {
    assert.equal(acpTransportRefusal({ transport: 'cli', bin: '' }), null)
  })

  it('refuses an ACP runtime with no launch command', () => {
    assert.match(String(acpTransportRefusal({ transport: 'acp', bin: '  ' })), /ACP mode/)
  })

  it('accepts an ACP runtime that has one', () => {
    assert.equal(acpTransportRefusal({ transport: 'acp', bin: 'gemini' }), null)
  })
})

describe('acpLaunchPresetFor', () => {
  it('knows Gemini speaks ACP natively', () => {
    const preset = acpLaunchPresetFor('gemini')
    assert.equal(preset?.bin, 'gemini')
    assert.deepEqual(preset?.args, ['--experimental-acp'])
  })

  it('knows fx speaks ACP natively', () => {
    const preset = acpLaunchPresetFor('fx')
    assert.equal(preset?.bin, 'fx')
    assert.deepEqual(preset?.args, ['acp'])
  })

  it('points Claude and Codex at their adapters', () => {
    assert.match(String(acpLaunchPresetFor('claude')?.args.join(' ')), /claude-code-acp/)
    assert.equal(acpLaunchPresetFor('codex')?.bin, 'codex-acp')
  })

  it('has nothing for runtimes with no known ACP mode', () => {
    assert.equal(acpLaunchPresetFor('grok'), undefined)
    assert.equal(acpLaunchPresetFor('generic'), undefined)
  })
})
