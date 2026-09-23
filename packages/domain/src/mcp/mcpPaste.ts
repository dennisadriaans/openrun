/**
 * Pasted MCP config → the servers Open Run shares.
 *
 * Every host documents its servers in a slightly different envelope: Claude
 * and `.mcp.json` use `mcpServers`, VS Code uses `servers` (or `mcp.servers`
 * inside settings.json), Codex uses a `[mcp_servers.*]` TOML table, and plenty
 * of READMEs paste the bare map or a single entry. All of them describe the
 * same server, so this module unwraps whichever one arrived and hands back
 * `McpServerConfig[]` — the shape `lib/mcp.ts` writes back out per dialect, so
 * one paste lands correctly in every CLI.
 *
 * Browser-safe (the `lib/` rule): the paste box parses with the same function
 * the server write path validates with.
 */
import {
  mcpServerRefusal,
  mcpServerSecretKeys,
  parseMcpServersMap,
  parseMcpServerEntry,
  parseTomlMcpServers,
  type McpServerConfig,
} from './mcp.ts'

export type McpPasteResult = {
  servers: McpServerConfig[]
  /** Why nothing could be read. Empty text yields no error and no servers. */
  error: string
  /** Things worth saying out loud before writing: secrets, placeholders. */
  warnings: string[]
}

/** Wrapper keys hosts nest their server map under, outermost first. */
const ENVELOPES = ['mcpServers', 'mcp_servers', 'servers', 'mcp']

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** An object that describes one server rather than a map of them. */
function looksLikeEntry(value: Record<string, unknown>): boolean {
  return (
    typeof value.command === 'string' ||
    typeof value.url === 'string' ||
    typeof value.httpUrl === 'string'
  )
}

function unwrap(doc: Record<string, unknown>): Record<string, unknown> {
  for (const key of ENVELOPES) {
    const inner = doc[key]
    if (!isObject(inner)) continue
    // `mcp` in a VS Code settings.json holds `servers`, not the map itself.
    return unwrap(inner)
  }
  return doc
}

/**
 * `${input:foo}` is a VS Code prompt, not a value any CLI expands — the paste
 * would install a server that cannot start until the user edits it.
 */
function placeholderKeys(server: McpServerConfig): string[] {
  const pairs = [...Object.entries(server.env ?? {}), ...Object.entries(server.headers ?? {})]
  return pairs.filter(([, value]) => /\$\{input:/i.test(value)).map(([key]) => key)
}

function warningsFor(servers: McpServerConfig[]): string[] {
  const out: string[] = []
  const secrets = [...new Set(servers.flatMap(mcpServerSecretKeys))]
  if (secrets.length > 0) {
    out.push(`Carries ${secrets.join(', ')} — copied into every CLI config on this machine.`)
  }
  const prompts = [...new Set(servers.flatMap(placeholderKeys))]
  if (prompts.length > 0) {
    out.push(`${prompts.join(', ')} uses a \${input:…} placeholder no CLI expands. Edit it after.`)
  }
  return out
}

/**
 * Read a pasted JSON or TOML config. `error` is developer-facing and the same
 * text the manual form would have refused with, so the paste box can say why
 * without a second vocabulary.
 */
export function parseMcpPaste(text: string): McpPasteResult {
  const trimmed = text.trim()
  if (!trimmed) return { servers: [], error: '', warnings: [] }

  const servers = trimmed.startsWith('{') ? fromJson(trimmed) : fromToml(trimmed)
  if (typeof servers === 'string') return { servers: [], error: servers, warnings: [] }

  const refused = servers.map((s) => mcpServerRefusal(s)).find((r): r is string => !!r)
  if (refused) return { servers: [], error: refused, warnings: [] }

  return { servers, error: '', warnings: warningsFor(servers) }
}

/** Servers, or the refusal to show instead. */
function fromJson(text: string): McpServerConfig[] | string {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (err) {
    return `That is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
  }
  if (!isObject(doc)) return 'Paste a JSON object, not a list or a bare value.'

  const map = unwrap(doc)

  // A single entry, either named inline (`{"name": "github", …}`) or unnamed.
  if (looksLikeEntry(map)) {
    const name = typeof map.name === 'string' ? map.name.trim() : ''
    if (!name) return 'That entry has no name. Wrap it as {"mcpServers": {"name": …}}.'
    const parsed = parseMcpServerEntry(name, map)
    return parsed ? [parsed] : 'That entry has neither a command nor a URL.'
  }

  const servers = parseMcpServersMap(map)
  if (servers.length === 0) return 'No MCP servers in there. Expected an "mcpServers" object.'
  return servers
}

function fromToml(text: string): McpServerConfig[] | string {
  const servers = parseTomlMcpServers(text)
  if (servers.length === 0) {
    return 'No MCP servers in there. Expected JSON, or a Codex [mcp_servers.name] table.'
  }
  return servers
}
