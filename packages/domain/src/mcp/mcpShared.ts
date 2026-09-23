/**
 * Shared MCP servers — defined once in Open Run, projected into every CLI.
 *
 * Every agent CLI keeps its own MCP registry, so a server added to Claude's
 * config is invisible to `codex`, `grok` and `gemini`. A *shared* server lives
 * in `~/.openrun/mcp.json` and is written out to each CLI's machine-wide
 * config, which is what makes "define it once, use it in any run" true.
 *
 * The projection is one-way and owned: Open Run records which names it wrote
 * where, so removing a shared server only deletes the copies it created and
 * never touches a server the user added to a CLI by hand. Where a name it does
 * not own is already present, the state is `conflict` and nothing is written
 * until the user says to overwrite.
 *
 * Browser-safe and dependency-free (`lib/` rule): the page renders the same
 * states the server write path computes.
 */
import { mcpServerSecretKeys, type McpServerConfig } from './mcp.ts'

/**
 * How one CLI's copy of a shared server compares with the shared definition.
 *
 * `unsupported` and `off` are not failures — they are the two reasons a CLI is
 * deliberately left without a copy, and the page says which rather than
 * showing a permanent red mark the user cannot clear.
 */
export type SharedSyncState = 'synced' | 'missing' | 'drifted' | 'conflict' | 'unsupported' | 'off'

function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  return left.length === right.length && left.every((v, i) => v === right[i])
}

function sameRecord(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const left = Object.entries(a ?? {}).sort(([x], [y]) => x.localeCompare(y))
  const right = Object.entries(b ?? {}).sort(([x], [y]) => x.localeCompare(y))
  return sameList(left.flat(), right.flat())
}

/**
 * Whether two entries would drive the agent to the same server.
 *
 * Compares only what Open Run writes — a host that adds a key of its own
 * (Claude's `type`, Grok's `enabled`) is still in sync.
 */
export function sameMcpServer(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.name !== b.name || a.transport !== b.transport) return false
  if (a.transport === 'stdio') {
    return (
      (a.command ?? '') === (b.command ?? '') &&
      sameList(a.args, b.args) &&
      sameRecord(a.env, b.env)
    )
  }
  return (a.url ?? '') === (b.url ?? '') && sameRecord(a.headers, b.headers)
}

/**
 * State of one shared server in one CLI's config.
 *
 * `managed` is Open Run's own record that it wrote this name here. An entry it
 * does not own but that already matches counts as `synced` — the user got
 * there first and there is nothing to do.
 */
export function sharedSyncState(input: {
  shared: McpServerConfig
  present?: McpServerConfig | undefined
  managed: boolean
  /** Set when the host cannot dial this transport at all. */
  unsupported?: boolean
}): SharedSyncState {
  if (input.unsupported) return 'unsupported'
  if (input.shared.disabled) return 'off'
  if (!input.present) return 'missing'
  if (sameMcpServer(input.shared, input.present)) return 'synced'
  return input.managed ? 'drifted' : 'conflict'
}

export function sharedSyncLabel(state: SharedSyncState): string {
  if (state === 'synced') return 'In sync'
  if (state === 'missing') return 'Not written yet'
  if (state === 'drifted') return 'Changed on disk'
  if (state === 'unsupported') return 'Not supported'
  if (state === 'off') return 'Turned off'
  return 'Name already taken'
}

/** Why a sync would refuse to touch this target, or null when it may write. */
export function sharedSyncRefusal(input: {
  state: SharedSyncState
  targetLabel: string
  file: string
}): string | null {
  if (input.state !== 'conflict') return null
  return `${input.targetLabel} already has a server with this name that Open Run did not add (${input.file}). Overwrite it, or rename the shared server.`
}

/** True when writing this state moves the CLI closer to the shared definition. */
export function needsSharedWrite(state: SharedSyncState): boolean {
  return state === 'missing' || state === 'drifted'
}

// --- Import: what the user already had before Open Run ---------------------

/** One CLI's copy of a server found during discovery. */
export type DiscoveredVariant = {
  targetId: string
  targetLabel: string
  file: string
  server: McpServerConfig
}

/**
 * A server found in at least one CLI config and not yet in the shared list.
 *
 * `ambiguous` is the case that matters: two CLIs hold the same *name* with
 * different settings, and there is no safe way to guess which the user meant.
 * Import offers the variants instead of merging them.
 */
export type DiscoveredServer = {
  name: string
  variants: DiscoveredVariant[]
  ambiguous: boolean
  /** Env/header keys that look like credentials, so import can say so. */
  secretKeys: string[]
}

export function groupDiscovered(variants: readonly DiscoveredVariant[]): DiscoveredServer[] {
  const byName = new Map<string, DiscoveredVariant[]>()
  for (const variant of variants) {
    const list = byName.get(variant.server.name)
    if (list) list.push(variant)
    else byName.set(variant.server.name, [variant])
  }
  return [...byName.entries()]
    .map(([name, list]) => {
      const first = list[0]?.server
      return {
        name,
        variants: list,
        ambiguous: !!first && list.some((v) => !sameMcpServer(first, v.server)),
        secretKeys: first ? mcpServerSecretKeys(first) : [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** One-line explanation of where a discovered server came from. */
export function discoveredOrigin(entry: DiscoveredServer): string {
  const names = entry.variants.map((v) => v.targetLabel.split('—')[0]?.trim() ?? v.targetLabel)
  if (names.length === 1) return `Found in ${names[0]}`
  return `Found in ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
