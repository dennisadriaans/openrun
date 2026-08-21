/**
 * Fan-out touches four real config files, so every test runs against a
 * throwaway `$HOME`. A CLI counts as set up only once its dot-file exists.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { McpServerConfig } from '../lib/mcp.ts'
import { saveMcpServer } from './mcp.ts'
import {
  discoverMcpServers,
  getSharedMcp,
  importMcpServers,
  removeSharedMcpServer,
  saveSharedMcpServer,
  sharedMcpFile,
  sharedMcpNeedsSync,
  syncSharedMcp,
} from './mcpShared.ts'

const dirs: string[] = []
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
let home = ''

const linear: McpServerConfig = {
  name: 'linear',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'linear-mcp'],
}

const sentrySse: McpServerConfig = {
  name: 'sentry',
  transport: 'sse',
  url: 'https://mcp.sentry.dev/sse',
}

/** Make a CLI look installed so the fan-out is allowed to write its config. */
function install(...clis: Array<'claude' | 'codex' | 'grok' | 'gemini'>): void {
  for (const cli of clis) {
    if (cli === 'claude') writeFileSync(join(home, '.claude.json'), '{}')
    else mkdirSync(join(home, `.${cli}`), { recursive: true })
  }
}

function sharedDoc(): Record<string, never> & Record<string, unknown> {
  return JSON.parse(readFileSync(sharedMcpFile(), 'utf8'))
}

function stateOf(name: string, targetId: string): string | undefined {
  return getSharedMcp()
    .servers.find((s) => s.server.name === name)
    ?.targets.find((t) => t.targetId === targetId)?.state
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openrun-shared-home-'))
  dirs.push(home)
  process.env.HOME = home
  process.env.USERPROFILE = home
  process.env.OPENRUN_HOME = join(home, '.openrun')
})

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
  process.env.HOME = savedEnv.HOME
  process.env.USERPROFILE = savedEnv.USERPROFILE
  delete process.env.OPENRUN_HOME
})

describe('saveSharedMcpServer', () => {
  it('writes one definition into every CLI that is set up here', () => {
    install('claude', 'codex', 'grok', 'gemini')
    const report = saveSharedMcpServer({ server: linear })

    assert.deepEqual(report.written.sort(), [
      'claude-user',
      'codex-user',
      'gemini-user',
      'grok-user',
    ])
    assert.match(
      readFileSync(join(home, '.codex', 'config.toml'), 'utf8'),
      /\[mcp_servers\.linear\]/,
    )
    assert.match(readFileSync(join(home, '.grok', 'config.toml'), 'utf8'), /enabled = true/)
    assert.ok(
      JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8')).mcpServers.linear,
    )
  })

  it('leaves a CLI the user has not installed without a config', () => {
    install('claude')
    const report = saveSharedMcpServer({ server: linear })

    assert.deepEqual(report.written, ['claude-user'])
    assert.ok(
      report.skipped.some((s) => s.targetId === 'codex-user' && /not set up/.test(s.reason)),
    )
    assert.equal(existsSync(join(home, '.codex', 'config.toml')), false)
  })

  it('skips a host that cannot dial the transport, and says why', () => {
    install('claude', 'codex')
    const report = saveSharedMcpServer({ server: sentrySse })

    assert.deepEqual(report.written, ['claude-user'])
    const skip = report.skipped.find((s) => s.targetId === 'codex-user')
    assert.match(String(skip?.reason), /cannot dial SSE/)
  })

  it('records the shared definition, its own copies, and nothing else', () => {
    install('claude', 'codex')
    saveSharedMcpServer({ server: linear })

    const doc = sharedDoc()
    assert.ok((doc.mcpServers as Record<string, unknown>).linear)
    assert.deepEqual((doc.openrun as { managed: Record<string, string[]> }).managed, {
      'claude-user': ['linear'],
      'codex-user': ['linear'],
    })
  })

  it('renames the copies it made rather than leaving both names behind', () => {
    install('claude', 'codex')
    saveSharedMcpServer({ server: linear })
    saveSharedMcpServer({ server: { ...linear, name: 'linear_prod' }, previousName: 'linear' })

    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.deepEqual(Object.keys(claude.mcpServers), ['linear_prod'])
    assert.doesNotMatch(
      readFileSync(join(home, '.codex', 'config.toml'), 'utf8'),
      /\[mcp_servers\.linear\]/,
    )
  })

  it('keeps a disabled server out of every CLI', () => {
    install('claude', 'codex')
    const report = saveSharedMcpServer({ server: { ...linear, disabled: true } })

    assert.deepEqual(report.written, [])
    assert.equal(stateOf('linear', 'claude-user'), 'off')
  })
})

describe('name conflicts', () => {
  it('refuses to overwrite a server the user added by hand', () => {
    install('claude', 'codex')
    saveMcpServer({
      bin: 'claude',
      targetId: 'claude-user',
      server: { ...linear, command: 'bunx' },
    })

    const report = saveSharedMcpServer({ server: linear })
    assert.deepEqual(report.written, ['codex-user'])
    assert.match(
      String(report.skipped.find((s) => s.targetId === 'claude-user')?.reason),
      /already has a server with this name/,
    )

    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.equal(claude.mcpServers.linear.command, 'bunx')
    assert.equal(getSharedMcp().conflicted, true)
  })

  it('overwrites once the user says to', () => {
    install('claude')
    saveMcpServer({
      bin: 'claude',
      targetId: 'claude-user',
      server: { ...linear, command: 'bunx' },
    })
    const report = saveSharedMcpServer({ server: linear, force: true })

    assert.deepEqual(report.written, ['claude-user'])
    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.equal(claude.mcpServers.linear.command, 'npx')
  })

  it('claims an identical entry the user got to first without rewriting it', () => {
    install('claude')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    const report = saveSharedMcpServer({ server: linear })

    assert.deepEqual(report.written, [])
    assert.equal(stateOf('linear', 'claude-user'), 'synced')
  })
})

describe('syncSharedMcp', () => {
  it('repairs a copy that was edited on disk', () => {
    install('claude')
    saveSharedMcpServer({ server: linear })
    saveMcpServer({
      bin: 'claude',
      targetId: 'claude-user',
      server: { ...linear, command: 'bunx' },
    })
    assert.equal(stateOf('linear', 'claude-user'), 'drifted')
    assert.equal(sharedMcpNeedsSync(getSharedMcp()), true)

    const report = syncSharedMcp()
    assert.deepEqual(report.written, ['claude-user'])
    assert.equal(stateOf('linear', 'claude-user'), 'synced')
    assert.equal(sharedMcpNeedsSync(getSharedMcp()), false)
  })

  it('does not read as out of sync because of a CLI that is not installed', () => {
    install('claude')
    saveSharedMcpServer({ server: linear })

    const view = getSharedMcp()
    assert.equal(view.outOfSync, false)
    assert.equal(sharedMcpNeedsSync(view), false)
    assert.deepEqual(syncSharedMcp().written, [])
  })

  it('writes into a CLI that was installed after the server was added', () => {
    install('claude')
    saveSharedMcpServer({ server: linear })
    install('codex')

    assert.equal(stateOf('linear', 'codex-user'), 'missing')
    assert.deepEqual(syncSharedMcp().written, ['codex-user'])
  })
})

describe('removeSharedMcpServer', () => {
  it('everywhere deletes only the copies Open Run made', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: { ...linear, name: 'mine' } })
    saveSharedMcpServer({ server: linear })

    const report = removeSharedMcpServer({ name: 'linear', scope: 'everywhere' })
    assert.deepEqual(report.written.sort(), ['claude-user', 'codex-user'])

    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    assert.doesNotMatch(toml, /\[mcp_servers\.linear\]/)
    assert.match(toml, /\[mcp_servers\.mine\]/)
    assert.deepEqual(getSharedMcp().servers, [])
  })

  it('registry forgets the server and leaves every CLI as it is', () => {
    install('claude')
    saveSharedMcpServer({ server: linear })
    removeSharedMcpServer({ name: 'linear', scope: 'registry' })

    const claude = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.ok(claude.mcpServers.linear)
    assert.deepEqual(getSharedMcp().servers, [])
    assert.deepEqual((sharedDoc().openrun as { managed: unknown }).managed, {})
  })

  it('never deletes an entry it did not add', () => {
    install('claude')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    const report = removeSharedMcpServer({ name: 'linear', scope: 'everywhere' })

    assert.deepEqual(report.written, [])
    assert.match(String(report.skipped[0]?.reason), /did not add it here/)
    assert.ok(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.linear)
  })
})

describe('discoverMcpServers', () => {
  it('offers what the CLIs already hold and skips what is already shared', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: { ...linear, name: 'context7' } })
    saveSharedMcpServer({ server: { ...linear, name: 'context7' } })

    const discovery = discoverMcpServers()
    assert.deepEqual(
      discovery.servers.map((s) => s.name),
      ['linear'],
    )
    assert.equal(discovery.scanned.length, 4)
    assert.equal(discovery.scanned.find((s) => s.targetId === 'grok-user')?.installed, false)
  })

  it('flags a name two CLIs disagree about instead of picking one', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    saveMcpServer({
      bin: 'codex',
      targetId: 'codex-user',
      server: { ...linear, command: 'bunx' },
    })

    const [entry] = discoverMcpServers().servers
    assert.equal(entry?.ambiguous, true)
    assert.deepEqual(entry?.variants.map((v) => v.targetId).sort(), ['claude-user', 'codex-user'])
  })
})

describe('importMcpServers', () => {
  it('takes the chosen copy and pushes it to the CLIs that lack it', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })

    const report = importMcpServers({ choices: [{ name: 'linear', fromTargetId: 'claude-user' }] })
    assert.deepEqual(report.imported, ['linear'])
    assert.deepEqual(report.fanOut.written, ['codex-user'])
    assert.match(
      readFileSync(join(home, '.codex', 'config.toml'), 'utf8'),
      /\[mcp_servers\.linear\]/,
    )
  })

  it('does not claim the config it imported from, so removing gives it back', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    importMcpServers({ choices: [{ name: 'linear', fromTargetId: 'claude-user' }] })
    removeSharedMcpServer({ name: 'linear', scope: 'everywhere' })

    assert.ok(JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers.linear)
    assert.doesNotMatch(
      readFileSync(join(home, '.codex', 'config.toml'), 'utf8'),
      /\[mcp_servers\.linear\]/,
    )
  })

  it('honours which CLI the user picked for a name they disagree about', () => {
    install('claude', 'codex')
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    saveMcpServer({
      bin: 'codex',
      targetId: 'codex-user',
      server: { ...linear, command: 'bunx' },
    })

    importMcpServers({ choices: [{ name: 'linear', fromTargetId: 'codex-user' }] })
    assert.equal(getSharedMcp().servers[0]?.server.command, 'bunx')
  })

  it('reports a choice that is no longer on disk instead of failing the import', () => {
    install('claude')
    const report = importMcpServers({ choices: [{ name: 'ghost', fromTargetId: 'claude-user' }] })
    assert.deepEqual(report.imported, [])
    assert.deepEqual(report.skipped, [{ name: 'ghost', reason: 'No longer on disk' }])
  })
})

describe('getSharedMcp', () => {
  it('describes every target, whether the CLI is here or not', () => {
    install('claude')
    saveSharedMcpServer({ server: linear })
    const view = getSharedMcp()

    assert.equal(view.file, join(home, '.openrun', 'mcp.json'))
    assert.deepEqual(
      view.targets.map((t) => [t.id, t.installed]),
      [
        ['claude-user', true],
        ['codex-user', false],
        ['grok-user', false],
        ['gemini-user', false],
      ],
    )
    assert.equal(view.outOfSync, false)
    assert.equal(view.conflicted, false)
  })

  it('is empty, not broken, before anything has been shared', () => {
    const view = getSharedMcp()
    assert.deepEqual(view.servers, [])
    assert.equal(view.outOfSync, false)
  })
})
