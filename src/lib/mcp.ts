/**
 * MCP server config — the shape, and how to read/write it in each CLI's own
 * config file.
 *
 * Open Run does not keep its own MCP registry. Every agent we drive already
 * has one (`~/.claude.json`, `<repo>/.mcp.json`, `~/.codex/config.toml`,
 * `~/.gemini/settings.json`), and a server we wrote somewhere else would be
 * invisible to the CLI the user runs by hand. So this module parses and edits
 * those files in place, and `lib/mcpTargets.ts` says which file belongs to
 * which runtime.
 *
 * Dependency-free (the `lib/` rule): the config editor form in the browser and
 * the server write path validate with the same functions, and the TOML helpers
 * are a deliberate minimal subset — enough for `[mcp_servers.*]` tables and
 * nothing else — rather than a parser dependency that would have to round-trip
 * a whole user config.
 */

/** How the agent reaches the server. `stdio` spawns it; the others dial it. */
export type McpTransportKind = 'stdio' | 'http' | 'sse'

export const MCP_TRANSPORT_KINDS: readonly McpTransportKind[] = ['stdio', 'http', 'sse']

export type McpServerConfig = {
  name: string
  transport: McpTransportKind
  /** stdio: the binary to spawn. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http / sse: the endpoint to dial. */
  url?: string
  headers?: Record<string, string>
  /**
   * False when the host config lists the server but has it switched off
   * (Claude's `disabledMcpjsonServers`). Absent means enabled.
   */
  disabled?: boolean
}

/**
 * Which JSON key layout a host expects.
 *
 * `standard` is what Claude writes: `{ type, url }`. Gemini CLI is different
 * enough to be a footgun — `httpUrl` is streamable HTTP and a bare `url` is
 * SSE — so a server written the standard way lands in Gemini as the wrong
 * transport and fails to connect.
 */
export type McpJsonDialect = 'standard' | 'gemini'

export function isMcpTransportKind(value: unknown): value is McpTransportKind {
  return typeof value === 'string' && (MCP_TRANSPORT_KINDS as readonly string[]).includes(value)
}

export function mcpTransportLabel(kind: McpTransportKind): string {
  if (kind === 'stdio') return 'Local process'
  if (kind === 'sse') return 'SSE'
  return 'HTTP'
}

/** One-line summary for a list row: the command line, or the endpoint. */
export function mcpServerSummary(server: McpServerConfig): string {
  if (server.transport === 'stdio') {
    return [server.command ?? '', ...(server.args ?? [])].join(' ').trim()
  }
  return server.url ?? ''
}

// --- Validation ------------------------------------------------------------

/** Bare-key safe: the same character set TOML and every JSON host accept. */
const NAME_RE = /^[A-Za-z0-9_-]+$/

/**
 * Developer-facing refusal for an MCP server draft, or null when it is
 * writable. Mirrored by the server write path so the form disables Save with
 * the exact message the server would have thrown.
 */
export function mcpServerRefusal(draft: {
  name?: string
  transport?: string
  command?: string
  url?: string
}): string | null {
  const name = (draft.name ?? '').trim()
  if (!name) return 'Give the server a name.'
  if (!NAME_RE.test(name)) return 'Server names may use letters, digits, dashes and underscores.'
  if (!isMcpTransportKind(draft.transport)) return 'Pick how the agent reaches this server.'
  if (draft.transport === 'stdio') {
    if (!(draft.command ?? '').trim()) return 'Enter the command that starts the server.'
    return null
  }
  const url = (draft.url ?? '').trim()
  if (!url) return 'Enter the server URL.'
  if (!/^https?:\/\/\S+$/i.test(url)) return 'The server URL must start with http:// or https://.'
  return null
}

export function assertMcpServer(draft: McpServerConfig): void {
  const refusal = mcpServerRefusal(draft)
  if (refusal) throw new Error(refusal)
}

// --- JSON-shaped configs ---------------------------------------------------

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = String(raw)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === 'string')
  return out.length > 0 ? out : undefined
}

/**
 * Read one entry of a `mcpServers` map.
 *
 * Hosts disagree on the discriminator: Claude writes `"type": "http"`, some
 * configs write `"transport"`, and plenty write neither and let the presence
 * of `url` vs `command` decide. All three are accepted.
 */
export function parseMcpServerEntry(
  name: string,
  value: unknown,
  dialect: McpJsonDialect = 'standard',
): McpServerConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const declared = typeof obj.type === 'string' ? obj.type : obj.transport
  const httpUrl = typeof obj.httpUrl === 'string' ? obj.httpUrl.trim() : ''
  const url = httpUrl || (typeof obj.url === 'string' ? obj.url.trim() : '')
  const command = typeof obj.command === 'string' ? obj.command.trim() : ''

  const transport: McpTransportKind = httpUrl
    ? 'http'
    : isMcpTransportKind(declared)
      ? declared
      : !url
        ? 'stdio'
        : dialect === 'gemini'
          ? 'sse'
          : 'http'

  if (transport === 'stdio') {
    if (!command) return null
    const args = stringArray(obj.args)
    const env = stringRecord(obj.env)
    return {
      name,
      transport,
      command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
    }
  }

  if (!url) return null
  const headers = stringRecord(obj.headers)
  return { name, transport, url, ...(headers ? { headers } : {}) }
}

/** Serialize back into the `mcpServers` map shape hosts read. */
export function mcpServerEntryToJson(
  server: McpServerConfig,
  dialect: McpJsonDialect = 'standard',
): Record<string, unknown> {
  const gemini = dialect === 'gemini'
  if (server.transport === 'stdio') {
    return {
      ...(gemini ? {} : { type: 'stdio' }),
      command: server.command ?? '',
      ...(server.args && server.args.length > 0 ? { args: server.args } : {}),
      ...(server.env && Object.keys(server.env).length > 0 ? { env: server.env } : {}),
    }
  }
  const headers =
    server.headers && Object.keys(server.headers).length > 0 ? { headers: server.headers } : {}
  if (gemini) {
    // `httpUrl` is streamable HTTP; a plain `url` is SSE. Not interchangeable.
    return server.transport === 'http'
      ? { httpUrl: server.url ?? '', ...headers }
      : { url: server.url ?? '', ...headers }
  }
  return { type: server.transport, url: server.url ?? '', ...headers }
}

/** Every readable entry of a `mcpServers` map, sorted by name. */
export function parseMcpServersMap(
  value: unknown,
  dialect: McpJsonDialect = 'standard',
): McpServerConfig[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const out: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = parseMcpServerEntry(name, entry, dialect)
    if (parsed) out.push(parsed)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Config keys on this server that look like credentials.
 *
 * Copying a server between CLIs copies whatever secret it carries, so the
 * import screen says which ones do rather than moving them silently.
 */
const SECRET_KEY_RE =
  /(token|key|secret|password|passwd|credential|auth|bearer|pat)$|^authorization$/i

export function mcpServerSecretKeys(server: McpServerConfig): string[] {
  const keys = [...Object.keys(server.env ?? {}), ...Object.keys(server.headers ?? {})]
  return keys.filter((key) => SECRET_KEY_RE.test(key)).sort()
}

/**
 * Walk a dotted pointer into a parsed JSON document, creating plain objects on
 * the way when `create` is set. Returns null when a segment is occupied by a
 * non-object, so a malformed host config is never silently overwritten.
 */
export function resolveJsonPointer(
  doc: Record<string, unknown>,
  pointer: readonly string[],
  create: boolean,
): Record<string, unknown> | null {
  let node: Record<string, unknown> = doc
  for (const segment of pointer) {
    const next = node[segment]
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      node = next as Record<string, unknown>
      continue
    }
    if (next !== undefined && next !== null) return null
    if (!create) return null
    const created: Record<string, unknown> = {}
    node[segment] = created
    node = created
  }
  return node
}

// --- TOML-shaped configs (Codex) -------------------------------------------

type TomlValue = string | string[] | boolean | Record<string, string>

function parseTomlString(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length < 2) return null
  const quote = trimmed[0]
  if ((quote !== '"' && quote !== "'") || !trimmed.endsWith(quote)) return null
  const body = trimmed.slice(1, -1)
  if (quote === "'") return body
  return body
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/** Split on a delimiter that is not inside a quoted string. */
function splitTopLevel(input: string, delimiter: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      current += ch
      if (ch === '\\') {
        const next = input[i + 1]
        if (next !== undefined) {
          current += next
          i += 1
        }
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === delimiter) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

function parseTomlValue(raw: string): TomlValue | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) {
    if (!trimmed.endsWith(']')) return null
    const inner = trimmed.slice(1, -1).trim()
    if (!inner) return []
    const parts = splitTopLevel(inner, ',')
      .map((p) => parseTomlString(p))
      .filter((p): p is string => p !== null)
    return parts
  }
  if (trimmed.startsWith('{')) {
    if (!trimmed.endsWith('}')) return null
    const inner = trimmed.slice(1, -1).trim()
    const out: Record<string, string> = {}
    if (!inner) return out
    for (const pair of splitTopLevel(inner, ',')) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      const key = pair
        .slice(0, eq)
        .trim()
        .replace(/^["']|["']$/g, '')
      const value = parseTomlString(pair.slice(eq + 1))
      if (key && value !== null) out[key] = value
    }
    return out
  }
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return parseTomlString(trimmed)
}

function tomlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function tomlInlineTable(record: Record<string, string>): string {
  const body = Object.entries(record)
    .map(([key, value]) => `${key} = ${tomlQuote(value)}`)
    .join(', ')
  return `{ ${body} }`
}

/** `[mcp_servers.name]` / `[mcp_servers.name.env]` header, or null. */
function tomlTableHeader(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null
  if (trimmed.startsWith('[[')) return null
  const inner = trimmed.slice(1, -1).trim()
  if (!inner) return null
  return splitTopLevel(inner, '.').map((part) => {
    const unquoted = parseTomlString(part)
    return unquoted === null ? part.trim() : unquoted
  })
}

const CODEX_SERVERS_TABLE = 'mcp_servers'

type TomlSection = {
  path: string[]
  /** Index of the header line, or -1 for the implicit root section. */
  start: number
  /** Exclusive end (index of the next header, or the line count). */
  end: number
}

function tomlSections(lines: string[]): TomlSection[] {
  const sections: TomlSection[] = []
  let current: TomlSection = { path: [], start: -1, end: lines.length }
  for (let i = 0; i < lines.length; i++) {
    const header = tomlTableHeader(lines[i]!)
    if (!header) continue
    current.end = i
    sections.push(current)
    current = { path: header, start: i, end: lines.length }
  }
  sections.push(current)
  return sections
}

function tomlSectionEntries(lines: string[], section: TomlSection): Record<string, TomlValue> {
  const out: Record<string, TomlValue> = {}
  for (let i = section.start + 1; i < section.end; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed
      .slice(0, eq)
      .trim()
      .replace(/^["']|["']$/g, '')
    const value = parseTomlValue(trimmed.slice(eq + 1))
    if (key && value !== null) out[key] = value
  }
  return out
}

/** Read `[mcp_servers.*]` out of a Codex-style config, sorted by name. */
export function parseTomlMcpServers(toml: string, table = CODEX_SERVERS_TABLE): McpServerConfig[] {
  const lines = toml.split('\n')
  const byName = new Map<string, McpServerConfig>()
  const envByName = new Map<string, Record<string, string>>()

  for (const section of tomlSections(lines)) {
    if (section.path[0] !== table || section.path.length < 2) continue
    const name = section.path[1]!
    const entries = tomlSectionEntries(lines, section)

    if (section.path.length === 3 && section.path[2] === 'env') {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === 'string') env[key] = value
      }
      if (Object.keys(env).length > 0) envByName.set(name, env)
      continue
    }
    if (section.path.length !== 2) continue

    const url = typeof entries.url === 'string' ? entries.url : ''
    const command = typeof entries.command === 'string' ? entries.command : ''
    // Grok writes `enabled = false` rather than dropping the table.
    const off = entries.enabled === false
    const declared = typeof entries.transport === 'string' ? entries.transport : undefined
    const transport: McpTransportKind = isMcpTransportKind(declared)
      ? declared
      : url
        ? 'http'
        : 'stdio'

    if (transport === 'stdio') {
      if (!command) continue
      const args = Array.isArray(entries.args) ? entries.args : undefined
      const env =
        entries.env && !Array.isArray(entries.env) && typeof entries.env === 'object'
          ? (entries.env as Record<string, string>)
          : undefined
      byName.set(name, {
        name,
        transport,
        command,
        ...(args && args.length > 0 ? { args } : {}),
        ...(env && Object.keys(env).length > 0 ? { env } : {}),
        ...(off ? { disabled: true } : {}),
      })
      continue
    }
    if (!url) continue
    const headers =
      entries.http_headers && typeof entries.http_headers === 'object'
        ? (entries.http_headers as Record<string, string>)
        : undefined
    byName.set(name, {
      name,
      transport,
      url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...(off ? { disabled: true } : {}),
    })
  }

  for (const [name, env] of envByName) {
    const server = byName.get(name)
    if (server && server.transport === 'stdio' && !server.env) server.env = env
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Hosts that read an explicit on/off key rather than table presence. */
export type TomlServerOptions = { enabledFlag?: boolean }

function renderTomlServer(
  server: McpServerConfig,
  table: string,
  options: TomlServerOptions = {},
): string[] {
  const lines = [`[${table}.${server.name}]`]
  const enabled = options.enabledFlag ? [`enabled = ${server.disabled ? 'false' : 'true'}`] : []
  if (server.transport === 'stdio') {
    lines.push(`command = ${tomlQuote(server.command ?? '')}`)
    if (server.args && server.args.length > 0) {
      lines.push(`args = [${server.args.map(tomlQuote).join(', ')}]`)
    }
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push(`env = ${tomlInlineTable(server.env)}`)
    }
    return [...lines, ...enabled]
  }
  lines.push(`url = ${tomlQuote(server.url ?? '')}`)
  if (server.transport !== 'http') lines.push(`transport = ${tomlQuote(server.transport)}`)
  if (server.headers && Object.keys(server.headers).length > 0) {
    lines.push(`http_headers = ${tomlInlineTable(server.headers)}`)
  }
  return [...lines, ...enabled]
}

/**
 * Cut every `[mcp_servers.<name>]` table (and its sub-tables) out of a config,
 * returning the surviving lines. Everything else — comments, ordering, unknown
 * settings — is left byte-for-byte alone, which is the whole point of editing
 * the user's real config rather than rewriting it from a parse.
 */
function removeTomlServerLines(lines: string[], table: string, name: string): string[] {
  const drop = new Set<number>()
  for (const section of tomlSections(lines)) {
    if (section.path[0] !== table || section.path[1] !== name) continue
    if (section.start < 0) continue
    for (let i = section.start; i < section.end; i++) drop.add(i)
  }
  if (drop.size === 0) return lines
  return lines.filter((_, i) => !drop.has(i))
}

function trimTrailingBlanks(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && out[out.length - 1]!.trim() === '') out.pop()
  return out
}

/** Add or replace one `[mcp_servers.<name>]` table. */
export function upsertTomlMcpServer(
  toml: string,
  server: McpServerConfig,
  table = CODEX_SERVERS_TABLE,
  options: TomlServerOptions = {},
): string {
  assertMcpServer(server)
  const kept = trimTrailingBlanks(removeTomlServerLines(toml.split('\n'), table, server.name))
  const block = renderTomlServer(server, table, options)
  const body = kept.length > 0 ? [...kept, '', ...block] : block
  return `${body.join('\n')}\n`
}

/** Drop one `[mcp_servers.<name>]` table, leaving the rest of the file alone. */
export function removeTomlMcpServer(
  toml: string,
  name: string,
  table = CODEX_SERVERS_TABLE,
): string {
  const kept = trimTrailingBlanks(removeTomlServerLines(toml.split('\n'), table, name))
  return kept.length > 0 ? `${kept.join('\n')}\n` : ''
}
