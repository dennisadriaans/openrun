/**
 * These tests write real config files, so every one runs against a throwaway
 * `$HOME` — `homedir()` and `openrunHome()` both resolve from the environment.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { McpServerConfig } from '../lib/mcp.ts'
import { mcpTargetsFor } from '../lib/mcpTargets.ts'
import {
  deleteServer,
  openrunToolServer,
  protocolMcpServers,
  removeMcpServer,
  resolveMcpTargets,
  resolveTarget,
  saveMcpServer,
} from './mcp.ts'

const dirs: string[] = []
const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE }
let home = ''
let workspace = ''

function targetFor(bin: string, id: string, transport?: string) {
  const target = mcpTargetsFor({ bin, ...(transport ? { transport } : {}) }).find(
    (t) => t.id === id,
  )
  assert.ok(target, `no such target: ${id}`)
  return target
}

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
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'openrun-mcp-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'openrun-mcp-ws-'))
  dirs.push(home, workspace)
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

describe('resolveTarget', () => {
  it('reports an absent user config as empty rather than broken', () => {
    const resolved = resolveTarget(targetFor('claude', 'claude-user'))
    assert.equal(resolved.file, join(home, '.claude.json'))
    assert.equal(resolved.exists, false)
    assert.deepEqual(resolved.servers, [])
    assert.equal(resolved.refusal, undefined)
  })

  it('refuses a project config with no workspace picked', () => {
    const resolved = resolveTarget(targetFor('claude', 'claude-project'))
    assert.equal(resolved.file, '')
    assert.match(String(resolved.refusal), /Pick a workspace/)
  })

  it('refuses a config that is not valid JSON instead of overwriting it', () => {
    writeFileSync(join(home, '.claude.json'), '{ not json')
    const resolved = resolveTarget(targetFor('claude', 'claude-user'))
    assert.match(String(resolved.refusal), /not valid JSON/)
    assert.deepEqual(resolved.servers, [])
  })

  it('reads servers a user already had, ignoring entries it cannot parse', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' },
          broken: { note: 'no command and no url' },
        },
      }),
    )
    const resolved = resolveTarget(targetFor('claude', 'claude-user'))
    assert.deepEqual(
      resolved.servers.map((s) => s.name),
      ['sentry'],
    )
  })
})

describe('saveMcpServer', () => {
  it('writes a stdio server into ~/.claude.json and reads it back', () => {
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })

    const doc = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.deepEqual(doc.mcpServers.linear, {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'linear-mcp'],
      env: { LINEAR_API_KEY: 'lin_abc' },
    })
    assert.deepEqual(resolveTarget(targetFor('claude', 'claude-user')).servers, [linear])
  })

  it('keeps the rest of a config the user already had', () => {
    writeFileSync(
      join(home, '.claude.json'),
      JSON.stringify({
        theme: 'dark',
        mcpServers: { sentry: { type: 'http', url: 'https://x/y' } },
      }),
    )
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })

    const doc = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.equal(doc.theme, 'dark')
    assert.deepEqual(Object.keys(doc.mcpServers).sort(), ['linear', 'sentry'])
  })

  it('keeps one backup of a config the first time it changes it', () => {
    const file = join(home, '.claude.json')
    writeFileSync(file, JSON.stringify({ mcpServers: {} }))
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    const backup = `${file}.openrun-backup`
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), { mcpServers: {} })

    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: sentry })
    assert.deepEqual(JSON.parse(readFileSync(backup, 'utf8')), { mcpServers: {} })
  })

  it('renames in place instead of leaving the old entry behind', () => {
    saveMcpServer({ bin: 'claude', targetId: 'claude-user', server: linear })
    saveMcpServer({
      bin: 'claude',
      targetId: 'claude-user',
      server: { ...linear, name: 'linear_prod' },
      previousName: 'linear',
    })
    assert.deepEqual(
      resolveTarget(targetFor('claude', 'claude-user')).servers.map((s) => s.name),
      ['linear_prod'],
    )
  })

  it('writes Codex TOML without inventing an enabled key', () => {
    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: linear })
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    assert.match(toml, /\[mcp_servers\.linear\]/)
    assert.match(toml, /command = "npx"/)
    assert.doesNotMatch(toml, /enabled =/)
  })

  it('writes the enabled key Grok expects, and trusts the folder for a workspace server', () => {
    saveMcpServer({ bin: 'grok', targetId: 'grok-project', cwd: workspace, server: linear })
    const toml = readFileSync(join(workspace, '.grok', 'config.toml'), 'utf8')
    assert.match(toml, /enabled = true/)

    const trust = readFileSync(join(home, '.grok', 'trusted_folders.toml'), 'utf8')
    assert.match(trust, new RegExp(`\\[folders\\."${workspace}"\\]`))
    assert.match(trust, /trusted = true/)
  })

  it('writes HTTP headers under the key each TOML host reads', () => {
    const stripe = {
      name: 'stripe',
      transport: 'http' as const,
      url: 'https://mcp.stripe.com',
      headers: { Authorization: 'Bearer t' },
    }
    saveMcpServer({ bin: 'grok', targetId: 'grok-user', server: stripe })
    const grok = readFileSync(join(home, '.grok', 'config.toml'), 'utf8')
    assert.match(grok, /^headers = \{ Authorization = "Bearer t" \}$/m)
    assert.doesNotMatch(grok, /http_headers/)

    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: stripe })
    const codex = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    assert.match(codex, /http_headers = \{ Authorization = "Bearer t" \}/)
  })

  it('records a workspace server as approved so an unattended Claude run may use it', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: {} }))
    saveMcpServer({ bin: 'claude', targetId: 'claude-project', cwd: workspace, server: linear })

    assert.ok(existsSync(join(workspace, '.mcp.json')))
    const doc = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.deepEqual(doc.projects[workspace].enabledMcpjsonServers, ['linear'])
    assert.deepEqual(doc.projects[workspace].disabledMcpjsonServers, [])
  })

  it('writes Gemini streamable HTTP as httpUrl, not as a bare url', () => {
    saveMcpServer({ bin: 'gemini', targetId: 'gemini-user', server: sentry })
    const doc = JSON.parse(readFileSync(join(home, '.gemini', 'settings.json'), 'utf8'))
    assert.deepEqual(doc.mcpServers.sentry, { httpUrl: 'https://mcp.sentry.dev/mcp' })
    assert.equal(resolveTarget(targetFor('gemini', 'gemini-user')).servers[0]?.transport, 'http')
  })

  it('refuses a transport the host cannot dial rather than writing a dead entry', () => {
    assert.throws(
      () =>
        saveMcpServer({
          bin: 'codex',
          targetId: 'codex-user',
          server: { ...sentry, transport: 'sse' },
        }),
      /cannot dial SSE/,
    )
    assert.equal(existsSync(join(home, '.codex', 'config.toml')), false)
  })

  it('refuses a draft the form would have rejected', () => {
    assert.throws(
      () =>
        saveMcpServer({
          bin: 'claude',
          targetId: 'claude-user',
          server: { name: 'bad name', transport: 'stdio', command: 'x' },
        }),
      /letters, digits, dashes/,
    )
  })

  it('refuses a target that belongs to another runtime', () => {
    assert.throws(
      () => saveMcpServer({ bin: 'claude', targetId: 'codex-user', server: linear }),
      /no such MCP config file/,
    )
  })
})

describe('removeMcpServer', () => {
  it('drops the entry and its approval record', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: {} }))
    saveMcpServer({ bin: 'claude', targetId: 'claude-project', cwd: workspace, server: linear })
    removeMcpServer({ bin: 'claude', targetId: 'claude-project', cwd: workspace, name: 'linear' })

    assert.deepEqual(resolveMcpTargets({ bin: 'claude', cwd: workspace })[1]?.servers, [])
    const doc = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'))
    assert.deepEqual(doc.projects[workspace].enabledMcpjsonServers, [])
  })

  it('leaves an unrelated server in a TOML config alone', () => {
    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: linear })
    saveMcpServer({ bin: 'codex', targetId: 'codex-user', server: sentry })
    removeMcpServer({ bin: 'codex', targetId: 'codex-user', name: 'linear' })

    assert.deepEqual(
      resolveTarget(targetFor('codex', 'codex-user')).servers.map((s) => s.name),
      ['sentry'],
    )
  })

  it('is a no-op when the config does not exist yet', () => {
    deleteServer(resolveTarget(targetFor('claude', 'claude-user')), 'linear')
    assert.equal(existsSync(join(home, '.claude.json')), false)
  })
})

describe('protocolMcpServers', () => {
  it('sends only the shared list, never a file the agent reads itself', () => {
    mkdirSync(join(home, '.openrun'), { recursive: true })
    writeFileSync(
      join(home, '.openrun', 'mcp.json'),
      JSON.stringify({ mcpServers: { linear: { type: 'stdio', command: 'npx' } } }),
    )
    saveMcpServer({ bin: 'gemini', targetId: 'gemini-user', server: sentry })

    const servers = protocolMcpServers({ bin: 'gemini', transport: 'acp', cwd: workspace })
    assert.deepEqual(
      servers.map((s) => s.name),
      ['linear'],
    )
  })

  it('has nothing to send for a CLI transport', () => {
    assert.deepEqual(protocolMcpServers({ bin: 'gemini', cwd: workspace }), [])
  })
})

describe('openrunToolServer', () => {
  it('points the agent at this checkout with the runtime that can execute it', () => {
    const server = openrunToolServer()
    assert.equal(server?.name, 'openrun')
    assert.equal(server?.transport, 'stdio')
    assert.equal(server?.command, process.execPath)
    assert.ok(server?.args?.includes('--experimental-strip-types'))
    assert.match(String(server?.args?.[1]), /scripts[\\/]mcp-server\.ts$/)
    assert.ok(existsSync(String(server?.args?.[1])))
  })
})
