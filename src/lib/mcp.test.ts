import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mcpServerEntryToJson,
  mcpServerRefusal,
  mcpServerSummary,
  parseMcpServerEntry,
  parseMcpServersMap,
  parseTomlMcpServers,
  removeTomlMcpServer,
  resolveJsonPointer,
  upsertTomlMcpServer,
} from './mcp.ts'

describe('parseMcpServerEntry', () => {
  it('reads a stdio server', () => {
    assert.deepEqual(
      parseMcpServerEntry('github', {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'x' },
      }),
      {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'x' },
      },
    )
  })

  it('infers http from a url when the host wrote no type', () => {
    assert.deepEqual(parseMcpServerEntry('nuxt-ui', { url: 'https://mcp.nuxt.com/sse' }), {
      name: 'nuxt-ui',
      transport: 'http',
      url: 'https://mcp.nuxt.com/sse',
    })
  })

  it('honours an explicit type over the shape', () => {
    const parsed = parseMcpServerEntry('x', { type: 'sse', url: 'https://example.com' })
    assert.equal(parsed?.transport, 'sse')
  })

  it('accepts `transport` as the discriminator too', () => {
    const parsed = parseMcpServerEntry('x', { transport: 'sse', url: 'https://example.com' })
    assert.equal(parsed?.transport, 'sse')
  })

  it('rejects entries with nothing to dial or spawn', () => {
    assert.equal(parseMcpServerEntry('x', {}), null)
    assert.equal(parseMcpServerEntry('x', 'nope'), null)
    assert.equal(parseMcpServerEntry('x', { type: 'http' }), null)
  })

  it('drops empty args and env rather than writing them back', () => {
    const parsed = parseMcpServerEntry('x', { command: 'run', args: [], env: {} })
    assert.deepEqual(parsed, { name: 'x', transport: 'stdio', command: 'run' })
  })
})

describe('mcpServerEntryToJson', () => {
  it('round-trips a stdio server', () => {
    const server = {
      name: 'x',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { A: '1' },
    }
    assert.deepEqual(parseMcpServerEntry('x', mcpServerEntryToJson(server)), server)
  })

  it('round-trips an http server with headers', () => {
    const server = {
      name: 'x',
      transport: 'http' as const,
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    }
    assert.deepEqual(parseMcpServerEntry('x', mcpServerEntryToJson(server)), server)
  })
})

describe('parseMcpServersMap', () => {
  it('sorts by name and skips unreadable entries', () => {
    const servers = parseMcpServersMap({
      zed: { command: 'z' },
      broken: {},
      alpha: { url: 'https://a.example' },
    })
    assert.deepEqual(
      servers.map((s) => s.name),
      ['alpha', 'zed'],
    )
  })

  it('tolerates a missing map', () => {
    assert.deepEqual(parseMcpServersMap(undefined), [])
    assert.deepEqual(parseMcpServersMap([]), [])
  })
})

describe('mcpServerRefusal', () => {
  it('accepts a valid stdio draft', () => {
    assert.equal(mcpServerRefusal({ name: 'my-server', transport: 'stdio', command: 'npx' }), null)
  })

  it('refuses names a config key cannot hold', () => {
    assert.match(String(mcpServerRefusal({ name: 'my server', transport: 'stdio' })), /letters/)
  })

  it('refuses a stdio server with no command', () => {
    assert.match(String(mcpServerRefusal({ name: 'x', transport: 'stdio' })), /command/)
  })

  it('refuses a url that is not http', () => {
    assert.match(
      String(mcpServerRefusal({ name: 'x', transport: 'http', url: 'ftp://nope' })),
      /http:\/\//,
    )
  })
})

describe('mcpServerSummary', () => {
  it('shows the command line for stdio', () => {
    assert.equal(
      mcpServerSummary({ name: 'x', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] }),
      'npx -y pkg',
    )
  })

  it('shows the endpoint otherwise', () => {
    assert.equal(
      mcpServerSummary({ name: 'x', transport: 'http', url: 'https://a.example' }),
      'https://a.example',
    )
  })
})

describe('resolveJsonPointer', () => {
  it('creates missing objects on the way down', () => {
    const doc: Record<string, unknown> = {}
    const node = resolveJsonPointer(doc, ['projects', '/repo', 'mcpServers'], true)
    assert.ok(node)
    node.x = 1
    assert.deepEqual(doc, { projects: { '/repo': { mcpServers: { x: 1 } } } })
  })

  it('refuses to overwrite a non-object on the path', () => {
    assert.equal(resolveJsonPointer({ mcpServers: 'oops' }, ['mcpServers'], true), null)
  })

  it('returns null for a missing path when not creating', () => {
    assert.equal(resolveJsonPointer({}, ['mcpServers'], false), null)
  })
})

const CODEX_CONFIG = `model = "gpt-5"

# keep me
[projects."/Users/me/repo"]
trust_level = "trusted"

[mcp_servers.nuxt-ui]
url = "https://mcp.nuxt.com/sse"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]
env = { GITHUB_TOKEN = "x" }
`

describe('parseTomlMcpServers', () => {
  it('reads http and stdio tables', () => {
    assert.deepEqual(parseTomlMcpServers(CODEX_CONFIG), [
      {
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: 'x' },
      },
      { name: 'nuxt-ui', transport: 'http', url: 'https://mcp.nuxt.com/sse' },
    ])
  })

  it('reads env written as its own sub-table', () => {
    const toml = `[mcp_servers.x]
command = "run"

[mcp_servers.x.env]
TOKEN = "t"
`
    assert.deepEqual(parseTomlMcpServers(toml), [
      { name: 'x', transport: 'stdio', command: 'run', env: { TOKEN: 't' } },
    ])
  })

  it('ignores unrelated tables', () => {
    assert.deepEqual(parseTomlMcpServers('[tui]\ntheme = "dark"\n'), [])
  })
})

describe('upsertTomlMcpServer', () => {
  it('appends a server and leaves the rest of the file alone', () => {
    const next = upsertTomlMcpServer(CODEX_CONFIG, {
      name: 'linear',
      transport: 'stdio',
      command: 'linear-mcp',
    })
    assert.ok(next.includes('# keep me'))
    assert.ok(next.includes('[projects."/Users/me/repo"]'))
    assert.deepEqual(
      parseTomlMcpServers(next).map((s) => s.name),
      ['github', 'linear', 'nuxt-ui'],
    )
  })

  it('replaces an existing server without duplicating the table', () => {
    const next = upsertTomlMcpServer(CODEX_CONFIG, {
      name: 'github',
      transport: 'stdio',
      command: 'gh-mcp',
    })
    assert.equal(next.match(/\[mcp_servers\.github\]/g)?.length, 1)
    const github = parseTomlMcpServers(next).find((s) => s.name === 'github')
    assert.equal(github?.command, 'gh-mcp')
    assert.equal(github?.args, undefined)
  })

  it('drops an env sub-table when the replacement has no env', () => {
    const toml = `[mcp_servers.x]
command = "run"

[mcp_servers.x.env]
TOKEN = "t"
`
    const next = upsertTomlMcpServer(toml, { name: 'x', transport: 'stdio', command: 'run2' })
    assert.ok(!next.includes('TOKEN'))
  })

  it('refuses an invalid draft', () => {
    assert.throws(() => upsertTomlMcpServer('', { name: 'x', transport: 'stdio' }))
  })

  it('escapes quotes in values', () => {
    const next = upsertTomlMcpServer('', {
      name: 'x',
      transport: 'stdio',
      command: 'say',
      args: ['he said "hi"'],
    })
    assert.deepEqual(parseTomlMcpServers(next)[0]?.args, ['he said "hi"'])
  })
})

describe('removeTomlMcpServer', () => {
  it('removes one table and keeps the others', () => {
    const next = removeTomlMcpServer(CODEX_CONFIG, 'github')
    assert.deepEqual(
      parseTomlMcpServers(next).map((s) => s.name),
      ['nuxt-ui'],
    )
    assert.ok(next.includes('model = "gpt-5"'))
  })

  it('is a no-op for an unknown name', () => {
    assert.deepEqual(
      parseTomlMcpServers(removeTomlMcpServer(CODEX_CONFIG, 'nope')).map((s) => s.name),
      ['github', 'nuxt-ui'],
    )
  })
})
