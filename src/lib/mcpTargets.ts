/**
 * Which config file holds a runtime's MCP servers.
 *
 * Open Run edits the CLI's own config rather than keeping a registry of its
 * own, so "where do this runtime's MCP servers live" is a per-CLI fact. Each
 * entry here is one editable file plus the pointer to the servers map inside
 * it; `server/mcp.ts` resolves the paths and does the IO.
 *
 * ACP runtimes get one extra target. Over the protocol the *client* hands the
 * agent its server list in `session/new`, so Open Run can add servers to an
 * agent that has no config file we know how to write — those live in
 * `~/.openrun/mcp.json` and are passed over the wire, never on disk for the
 * agent to find.
 *
 * Browser-safe (`lib/` rule): the MCP page renders straight from these
 * descriptors and the server write path resolves the same ids.
 */
import { modelKindForBin, type RuntimeModelKind } from './models.ts'
import { isAcpTransport } from './acpTransport.ts'
import {
  mcpTransportLabel,
  type McpJsonDialect,
  type McpTransportKind,
  type TomlHeaderKey,
} from './mcp.ts'

export type McpConfigFormat = 'json' | 'toml'

/**
 * `user` is machine-wide, `project` lives in the workspace and is committed
 * with it, `openrun` is the protocol-only list described above.
 */
export type McpConfigScope = 'user' | 'project' | 'openrun'

export type McpTarget = {
  /** Stable id the UI and the write path address this file by. */
  id: string
  label: string
  scope: McpConfigScope
  format: McpConfigFormat
  /** Home-relative for user scope, workspace-relative for project scope. */
  path: string
  /** Where the servers map sits inside a JSON document. */
  pointer: string[]
  /** Table name inside a TOML document. */
  table?: string
  /** Host reads an explicit `enabled` key instead of table presence (Grok). */
  enabledFlag?: boolean
  /** Codex `http_headers`; Grok `headers` — the other is ignored. */
  headerKey?: TomlHeaderKey
  /** Host only starts this file's servers once the folder is trusted (Grok). */
  needsFolderTrust?: boolean
  /**
   * Transports this host can actually dial. Writing one it does not know is
   * worse than skipping: the CLI either ignores the entry or refuses the whole
   * config file, so the fan-out checks this first.
   */
  supports: readonly McpTransportKind[]
  /** JSON key layout, for the hosts that disagree about it. */
  dialect?: McpJsonDialect
  /**
   * Home-relative paths that mean this CLI is set up on the machine. Writing a
   * config for a CLI the user does not have would create the impression they
   * installed it, so the fan-out skips those targets until one of these exists.
   */
  presence?: readonly string[]
  /** One line under the picker: who else reads this file. */
  description: string
}

const CLAUDE_USER: McpTarget = {
  id: 'claude-user',
  label: 'Claude Code — this machine',
  scope: 'user',
  format: 'json',
  path: '.claude.json',
  pointer: ['mcpServers'],
  supports: ['stdio', 'http', 'sse'],
  presence: ['.claude.json', '.claude'],
  description: 'Every Claude Code session on this machine, including the one you run by hand.',
}

const CLAUDE_PROJECT: McpTarget = {
  id: 'claude-project',
  label: 'Claude Code — this workspace',
  scope: 'project',
  format: 'json',
  path: '.mcp.json',
  pointer: ['mcpServers'],
  supports: ['stdio', 'http', 'sse'],
  description: 'Committed with the repo — anyone who clones it gets these servers.',
}

const CODEX_USER: McpTarget = {
  id: 'codex-user',
  label: 'Codex — this machine',
  scope: 'user',
  format: 'toml',
  path: '.codex/config.toml',
  pointer: [],
  table: 'mcp_servers',
  // 0.142 reads `url` as streamable HTTP; its `transport` enum has no SSE.
  supports: ['stdio', 'http'],
  presence: ['.codex'],
  description: 'Every `codex` session on this machine.',
}

const GROK_USER: McpTarget = {
  id: 'grok-user',
  label: 'Grok — this machine',
  scope: 'user',
  format: 'toml',
  path: '.grok/config.toml',
  pointer: [],
  table: 'mcp_servers',
  enabledFlag: true,
  headerKey: 'headers',
  supports: ['stdio', 'http'],
  presence: ['.grok'],
  description:
    'Every `grok` session on this machine — unless a workspace config defines the same name, which replaces this entry outright.',
}

const GROK_PROJECT: McpTarget = {
  id: 'grok-project',
  label: 'Grok — this workspace',
  scope: 'project',
  format: 'toml',
  path: '.grok/config.toml',
  pointer: [],
  table: 'mcp_servers',
  enabledFlag: true,
  headerKey: 'headers',
  needsFolderTrust: true,
  supports: ['stdio', 'http'],
  description:
    'Committed with the repo. Grok starts these only in a trusted folder — Open Run records the trust when you save.',
}

const GEMINI_USER: McpTarget = {
  id: 'gemini-user',
  label: 'Gemini CLI — this machine',
  scope: 'user',
  format: 'json',
  path: '.gemini/settings.json',
  pointer: ['mcpServers'],
  supports: ['stdio', 'http', 'sse'],
  dialect: 'gemini',
  presence: ['.gemini'],
  description: 'Every `gemini` session on this machine.',
}

const GEMINI_PROJECT: McpTarget = {
  id: 'gemini-project',
  label: 'Gemini CLI — this workspace',
  scope: 'project',
  format: 'json',
  path: '.gemini/settings.json',
  pointer: ['mcpServers'],
  supports: ['stdio', 'http', 'sse'],
  dialect: 'gemini',
  description: 'Committed with the repo — anyone who clones it gets these servers.',
}

const OPENRUN_ACP: McpTarget = {
  id: 'openrun-acp',
  label: 'Open Run — sent over ACP',
  scope: 'openrun',
  format: 'json',
  path: 'mcp.json',
  pointer: ['mcpServers'],
  supports: ['stdio', 'http', 'sse'],
  description:
    'The shared list, handed to the agent when the session opens. Editing it here is the same as editing Shared servers above.',
}

/**
 * The machine-wide config of every CLI Open Run knows how to write.
 *
 * A shared server is defined once in `~/.openrun/mcp.json` and projected into
 * each of these, so `claude`, `codex`, `grok` and `gemini` all see it — which
 * is the only way "install it once" can be true when every CLI keeps its own
 * registry. Project-scoped files are deliberately absent: they are committed
 * with a repo and belong to that repo, not to the machine.
 */
export const SHARED_MCP_TARGETS: readonly McpTarget[] = [
  CLAUDE_USER,
  CODEX_USER,
  GROK_USER,
  GEMINI_USER,
]

export function sharedMcpTargetById(id: string): McpTarget | undefined {
  return SHARED_MCP_TARGETS.find((t) => t.id === id)
}

/** Why this host cannot hold this server, or null when it can. */
export function transportRefusal(target: McpTarget, transport: McpTransportKind): string | null {
  if (target.supports.includes(transport)) return null
  const supported = target.supports.map(mcpTransportLabel).join(' and ')
  return `${target.label} cannot dial ${mcpTransportLabel(transport)} servers — it supports ${supported}.`
}

function nativeTargets(kind: RuntimeModelKind): McpTarget[] {
  if (kind === 'claude') return [CLAUDE_USER, CLAUDE_PROJECT]
  if (kind === 'codex') return [CODEX_USER]
  if (kind === 'grok') return [GROK_USER, GROK_PROJECT]
  if (kind === 'gemini') return [GEMINI_USER, GEMINI_PROJECT]
  return []
}

/**
 * Config files this runtime's MCP servers can live in, most specific last.
 *
 * An ACP runtime always has at least the protocol target, even when its binary
 * has no config file we can write.
 */
export function mcpTargetsFor(input: { bin: string; transport?: string | null }): McpTarget[] {
  const kind = modelKindForBin(input.bin)
  const targets = nativeTargets(kind)
  if (isAcpTransport(input.transport)) return [...targets, OPENRUN_ACP]
  return targets
}

export function mcpTargetById(
  input: { bin: string; transport?: string | null },
  id: string,
): McpTarget | undefined {
  return mcpTargetsFor(input).find((t) => t.id === id)
}

/**
 * Why this runtime cannot be given MCP servers, or null when it can.
 *
 * Mirrors the server write path so the page explains instead of failing after
 * the click (AGENTS.md gate rule).
 */
export function mcpSupportRefusal(input: {
  bin: string
  transport?: string | null
}): string | null {
  if (mcpTargetsFor(input).length > 0) return null
  const kind = modelKindForBin(input.bin)
  if (kind === 'generic') {
    return 'Open Run does not know where this command keeps its MCP servers. Switch the runtime to the Agent Client Protocol transport to hand it servers over the protocol instead.'
  }
  const name = input.bin.split(/[\\/]/).pop() || input.bin
  return `\`${name}\` has no MCP config Open Run can edit. Switch the runtime to the Agent Client Protocol transport to hand it servers over the protocol instead.`
}

/** True when Open Run passes this target's servers in `session/new` itself. */
export function isProtocolTarget(target: McpTarget): boolean {
  return target.scope === 'openrun'
}
