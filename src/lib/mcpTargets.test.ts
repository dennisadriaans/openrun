import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isProtocolTarget, mcpSupportRefusal, mcpTargetById, mcpTargetsFor } from './mcpTargets.ts'

describe('mcpTargetsFor', () => {
  it('gives Claude a user file and a workspace file', () => {
    assert.deepEqual(
      mcpTargetsFor({ bin: 'claude' }).map((t) => t.id),
      ['claude-user', 'claude-project'],
    )
  })

  it('gives Codex its TOML config', () => {
    const target = mcpTargetsFor({ bin: 'codex' })[0]
    assert.equal(target?.format, 'toml')
    assert.equal(target?.table, 'mcp_servers')
  })

  it('adds the protocol target for an ACP runtime', () => {
    const ids = mcpTargetsFor({ bin: 'gemini', transport: 'acp' }).map((t) => t.id)
    assert.deepEqual(ids, ['gemini-user', 'gemini-project', 'openrun-acp'])
  })

  it('gives an ACP agent with no config file the protocol target alone', () => {
    assert.deepEqual(
      mcpTargetsFor({ bin: 'fx', transport: 'acp' }).map((t) => t.id),
      ['openrun-acp'],
    )
  })

  it('gives Grok a user file and a workspace file, both needing its enabled flag', () => {
    const targets = mcpTargetsFor({ bin: 'grok' })
    assert.deepEqual(
      targets.map((t) => t.id),
      ['grok-user', 'grok-project'],
    )
    assert.ok(targets.every((t) => t.enabledFlag))
    assert.equal(targets[1]?.needsFolderTrust, true)
  })

  it('has nothing for a CLI whose config we do not know', () => {
    assert.deepEqual(mcpTargetsFor({ bin: 'agy' }), [])
  })
})

describe('mcpSupportRefusal', () => {
  it('is silent for a runtime that has somewhere to write', () => {
    assert.equal(mcpSupportRefusal({ bin: 'claude' }), null)
    assert.equal(mcpSupportRefusal({ bin: 'fx', transport: 'acp' }), null)
  })

  it('names the binary it cannot place', () => {
    assert.match(String(mcpSupportRefusal({ bin: '/opt/bin/agy' })), /agy/)
  })

  it('points an unknown command at the ACP transport', () => {
    assert.match(String(mcpSupportRefusal({ bin: 'my-agent' })), /Agent Client Protocol/)
  })
})

describe('mcpTargetById', () => {
  it('finds a target the runtime has', () => {
    assert.equal(mcpTargetById({ bin: 'claude' }, 'claude-project')?.scope, 'project')
  })

  it('returns nothing for a target belonging to another runtime', () => {
    assert.equal(mcpTargetById({ bin: 'claude' }, 'codex-user'), undefined)
  })
})

describe('isProtocolTarget', () => {
  it('is true only for the list Open Run sends itself', () => {
    const targets = mcpTargetsFor({ bin: 'gemini', transport: 'acp' })
    assert.deepEqual(
      targets.filter(isProtocolTarget).map((t) => t.id),
      ['openrun-acp'],
    )
  })
})
