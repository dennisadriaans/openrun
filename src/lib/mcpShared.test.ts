import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { McpServerConfig } from './mcp.ts'
import {
  discoveredOrigin,
  groupDiscovered,
  needsSharedWrite,
  sameMcpServer,
  sharedSyncLabel,
  sharedSyncRefusal,
  sharedSyncState,
  type DiscoveredVariant,
} from './mcpShared.ts'

const linear: McpServerConfig = {
  name: 'linear',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'linear-mcp'],
  env: { LINEAR_API_KEY: 'lin_abc' },
}

const sentry: McpServerConfig = {
  name: 'sentry',
  transport: 'http',
  url: 'https://mcp.sentry.dev/mcp',
  headers: { Authorization: 'Bearer tok' },
}

function variant(targetId: string, label: string, server: McpServerConfig): DiscoveredVariant {
  return { targetId, targetLabel: label, file: `/home/dev/${targetId}.json`, server }
}

describe('sameMcpServer', () => {
  it('ignores key order in env and headers', () => {
    assert.ok(
      sameMcpServer({ ...linear, env: { A: '1', B: '2' } }, { ...linear, env: { B: '2', A: '1' } }),
    )
  })

  it('ignores a host key Open Run does not write', () => {
    assert.ok(sameMcpServer(linear, { ...linear, disabled: undefined }))
  })

  it('sees a changed command, argument order, or url as different', () => {
    assert.equal(sameMcpServer(linear, { ...linear, command: 'bunx' }), false)
    assert.equal(sameMcpServer(linear, { ...linear, args: ['linear-mcp', '-y'] }), false)
    assert.equal(sameMcpServer(sentry, { ...sentry, url: 'https://other/mcp' }), false)
  })

  it('never matches across a transport change', () => {
    assert.equal(sameMcpServer(sentry, { ...sentry, transport: 'sse' }), false)
  })

  it('treats an absent list as an empty one', () => {
    const bare: McpServerConfig = { name: 'x', transport: 'stdio', command: 'x' }
    assert.ok(sameMcpServer(bare, { ...bare, args: [], env: {} }))
  })
})

describe('sharedSyncState', () => {
  it('is missing when the CLI has no copy yet', () => {
    assert.equal(sharedSyncState({ shared: linear, managed: false }), 'missing')
  })

  it('is synced when the user got there first with an identical entry', () => {
    assert.equal(sharedSyncState({ shared: linear, present: linear, managed: false }), 'synced')
  })

  it('separates our own copy drifting from a name we never wrote', () => {
    const edited = { ...linear, command: 'bunx' }
    assert.equal(sharedSyncState({ shared: linear, present: edited, managed: true }), 'drifted')
    assert.equal(sharedSyncState({ shared: linear, present: edited, managed: false }), 'conflict')
  })

  it('reports the deliberate non-writes ahead of everything else', () => {
    assert.equal(
      sharedSyncState({ shared: sentry, managed: false, unsupported: true }),
      'unsupported',
    )
    assert.equal(sharedSyncState({ shared: { ...linear, disabled: true }, managed: true }), 'off')
  })
})

describe('sharedSyncRefusal', () => {
  it('names the file only for a conflict', () => {
    const refusal = sharedSyncRefusal({
      state: 'conflict',
      targetLabel: 'Codex — this machine',
      file: '~/.codex/config.toml',
    })
    assert.match(String(refusal), /Codex — this machine/)
    assert.match(String(refusal), /~\/\.codex\/config\.toml/)
    assert.equal(sharedSyncRefusal({ state: 'drifted', targetLabel: 'x', file: 'y' }), null)
  })
})

describe('needsSharedWrite', () => {
  it('writes only what a sync can actually repair', () => {
    assert.equal(needsSharedWrite('missing'), true)
    assert.equal(needsSharedWrite('drifted'), true)
    for (const settled of ['synced', 'conflict', 'unsupported', 'off'] as const) {
      assert.equal(needsSharedWrite(settled), false)
    }
  })
})

describe('sharedSyncLabel', () => {
  it('gives every state a plain-language label', () => {
    assert.equal(sharedSyncLabel('synced'), 'In sync')
    assert.equal(sharedSyncLabel('missing'), 'Not written yet')
    assert.equal(sharedSyncLabel('drifted'), 'Changed on disk')
    assert.equal(sharedSyncLabel('unsupported'), 'Not supported')
    assert.equal(sharedSyncLabel('off'), 'Turned off')
    assert.equal(sharedSyncLabel('conflict'), 'Name already taken')
  })
})

describe('groupDiscovered', () => {
  it('folds identical copies of one name into a single unambiguous entry', () => {
    const [entry] = groupDiscovered([
      variant('claude-user', 'Claude Code — this machine', linear),
      variant('codex-user', 'Codex — this machine', linear),
    ])
    assert.equal(entry?.name, 'linear')
    assert.equal(entry?.variants.length, 2)
    assert.equal(entry?.ambiguous, false)
  })

  it('flags two CLIs holding the same name with different settings', () => {
    const [entry] = groupDiscovered([
      variant('claude-user', 'Claude Code — this machine', linear),
      variant('codex-user', 'Codex — this machine', { ...linear, command: 'bunx' }),
    ])
    assert.equal(entry?.ambiguous, true)
  })

  it('surfaces the credential keys a copy would carry', () => {
    const [entry] = groupDiscovered([variant('claude-user', 'Claude Code', linear)])
    assert.deepEqual(entry?.secretKeys, ['LINEAR_API_KEY'])
    const [header] = groupDiscovered([variant('claude-user', 'Claude Code', sentry)])
    assert.deepEqual(header?.secretKeys, ['Authorization'])
  })

  it('sorts by name so the import list is stable between scans', () => {
    const entries = groupDiscovered([
      variant('claude-user', 'Claude Code', sentry),
      variant('codex-user', 'Codex', linear),
    ])
    assert.deepEqual(
      entries.map((e) => e.name),
      ['linear', 'sentry'],
    )
  })
})

describe('discoveredOrigin', () => {
  it('names one CLI, or lists them with an "and"', () => {
    const one = groupDiscovered([variant('claude-user', 'Claude Code — this machine', linear)])
    assert.equal(discoveredOrigin(one[0]!), 'Found in Claude Code')

    const three = groupDiscovered([
      variant('claude-user', 'Claude Code — this machine', linear),
      variant('codex-user', 'Codex — this machine', linear),
      variant('gemini-user', 'Gemini CLI — this machine', linear),
    ])
    assert.equal(discoveredOrigin(three[0]!), 'Found in Claude Code, Codex and Gemini CLI')
  })
})
