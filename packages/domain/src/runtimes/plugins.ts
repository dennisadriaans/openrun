/**
 * Plugins the CLIs already have, and the `$name` mention that reaches them.
 *
 * Codex and Claude Code both ship a plugin system of their own: a bundle of
 * skills, MCP servers, hooks and vendor app connectors, installed with
 * `codex plugin add` / `/plugin`. Open Run does not own any of it — the same
 * rule as `lib/mcp.ts` and `lib/slashCommands.ts`: the CLI's registry is the
 * registry, and a plugin Open Run invented somewhere else would be invisible
 * to the `codex` the user runs by hand.
 *
 * So this module only knows the shapes, and `server/plugins.ts` reads them off
 * disk. What Open Run adds is the composer: `$` opens the same menu the CLI's
 * own TUI offers, and the mention goes to the agent as typed. Codex encodes a
 * picked mention as `[mention:$name](target)`, but it resolves a bare `$name`
 * in the prompt text too, which is the only form a headless `codex exec -` can
 * carry.
 *
 * Browser-safe and dependency-free (`lib/` rule): the composer menu and the
 * MCP page render straight from these types, and the server walker validates
 * with the same parsers.
 */

/** A CLI that has a plugin system Open Run can read. */
export type PluginHost = 'codex' | 'claude'

/** What a plugin contributes to a session. */
export type PluginCapability = 'skills' | 'mcp' | 'apps' | 'hooks' | 'commands' | 'agents'

/**
 * A vendor connector a plugin talks through — Gmail, Linear, Slack.
 *
 * The tools live on the vendor's side of an account the *CLI* is signed into,
 * not in a local process, so Open Run can name one but can never authorize it.
 */
export type PluginApp = {
  name: string
  /** The host's own connector id, for support and for telling two apart. */
  connectorId: string
  /** The plugin refuses to work without it. */
  required: boolean
}

export type AgentPlugin = {
  /** Mention name: what `$name` in a prompt resolves to. */
  name: string
  displayName: string
  description: string
  version: string
  host: PluginHost
  /** Marketplace or local root it was installed from. */
  source: string
  /** Absolute install directory. */
  path: string
  capabilities: PluginCapability[]
  /** Skills it contributes, as the host lists them (`plugin:skill`). */
  skills: string[]
  apps: PluginApp[]
}

export type PluginListing = {
  plugins: AgentPlugin[]
  /** Caveat shown under the menu — how this runtime treats a mention. */
  note?: string
}

/** Hosts with a plugin system. Everything else gets an empty listing. */
export function pluginHostForKind(kind: string): PluginHost | null {
  if (kind === 'codex') return 'codex'
  if (kind === 'claude') return 'claude'
  return null
}

export function pluginHostLabel(host: PluginHost): string {
  return host === 'codex' ? 'Codex' : 'Claude Code'
}

/** The command that installs or removes plugins for this host. */
export function pluginManageHint(host: PluginHost): string {
  return host === 'codex' ? 'codex plugin add <name>' : '/plugin inside claude'
}

export function pluginCapabilityLabel(capability: PluginCapability): string {
  if (capability === 'mcp') return 'MCP servers'
  if (capability === 'apps') return 'Apps'
  if (capability === 'skills') return 'Skills'
  if (capability === 'hooks') return 'Hooks'
  if (capability === 'commands') return 'Commands'
  return 'Agents'
}

/**
 * Why a plugin may do nothing in an unattended run.
 *
 * A local bundle (skills, hooks, an stdio MCP server) works headlessly because
 * everything it needs is on the machine. An app connector is an account the
 * CLI holds on the vendor's side, and an expired one prompts for a sign-in
 * that a run has nobody to answer — so the run does not fail, it silently
 * loses the tool. Naming that up front beats discovering it in a transcript.
 */
export function pluginAuthCaveat(plugin: AgentPlugin): string | undefined {
  const required = plugin.apps.filter((app) => app.required)
  if (required.length === 0) return undefined
  const names = required.map((app) => app.name).join(', ')
  return `Needs the ${names} app connected in ${pluginHostLabel(plugin.host)}. A run cannot answer a sign-in prompt, so authorize it there first.`
}

// --- Mentions ---------------------------------------------------------------

/**
 * A mention is a `$` plus the plugin name. The first character must not be a
 * digit, so a price in a prompt (`under $500`) never opens the menu.
 */
const MENTION_RE = /(^|\s)\$((?:[A-Za-z_][\w-]*)?)$/

/**
 * What has been typed after a `$`, or null when the caret is not in a mention.
 *
 * Unlike `/`, a mention can sit anywhere in the prompt, so this looks at the
 * end of the text rather than the start.
 */
export function pluginMenuQuery(text: string): string | null {
  const match = MENTION_RE.exec(text)
  return match ? (match[2] ?? '') : null
}

/** Replace the half-typed mention at the caret with this plugin's name. */
export function applyPluginMention(text: string, plugin: AgentPlugin): string {
  return text.replace(MENTION_RE, (_full, lead: string) => `${lead}$${plugin.name} `)
}

function rank(plugin: AgentPlugin, query: string): number {
  const name = plugin.name.toLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (name.includes(query)) return 2
  if (plugin.displayName.toLowerCase().includes(query)) return 3
  return plugin.description.toLowerCase().includes(query) ? 4 : -1
}

/** Plugins matching what has been typed after the `$`, best match first. */
export function matchPlugins(plugins: readonly AgentPlugin[], query: string): AgentPlugin[] {
  const q = query.trim().toLowerCase()
  const scored = plugins
    .map((plugin) => ({ plugin, score: q ? rank(plugin, q) : 1 }))
    .filter((entry) => entry.score >= 0)
  scored.sort((a, b) => a.score - b.score || a.plugin.name.localeCompare(b.plugin.name))
  return scored.map((entry) => entry.plugin)
}

/** Mentions in a prompt that no installed plugin answers. */
export function unknownMentions(text: string, plugins: readonly AgentPlugin[]): string[] {
  const known = new Set(plugins.map((plugin) => plugin.name.toLowerCase()))
  const out: string[] = []
  for (const match of text.matchAll(/(?:^|\s)\$([A-Za-z_][\w-]*)/g)) {
    const name = match[1]!
    if (!known.has(name.toLowerCase()) && !out.includes(name)) out.push(name)
  }
  return out
}

// --- Manifest parsing -------------------------------------------------------

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Read a Codex `.codex-plugin/plugin.json`.
 *
 * `interface` is the marketplace card the TUI renders; the top-level fields
 * are the contract. Both are the host's format and can move on a CLI upgrade,
 * so everything is optional and a manifest we cannot read yields null rather
 * than a half-populated row.
 */
export function parseCodexPluginManifest(
  raw: unknown,
): { name: string; version: string; displayName: string; description: string } | null {
  if (!isRecord(raw)) return null
  const name = str(raw.name).trim()
  if (!name) return null
  const iface = isRecord(raw.interface) ? raw.interface : {}
  return {
    name,
    version: str(raw.version),
    displayName: str(iface.displayName) || name,
    description: str(iface.shortDescription) || str(raw.description),
  }
}

/** Read a Codex `.app.json` — the connectors the plugin's skills call through. */
export function parseCodexApps(raw: unknown): PluginApp[] {
  if (!isRecord(raw) || !isRecord(raw.apps)) return []
  const out: PluginApp[] = []
  for (const [name, value] of Object.entries(raw.apps)) {
    if (!isRecord(value)) continue
    out.push({ name, connectorId: str(value.id), required: value.required === true })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Read a Claude `.claude-plugin/plugin.json`. */
export function parseClaudePluginManifest(
  raw: unknown,
  fallbackName: string,
): { name: string; version: string; description: string; hasHooks: boolean } | null {
  if (!isRecord(raw)) return null
  const name = str(raw.name).trim() || fallbackName
  if (!name) return null
  return {
    name,
    version: str(raw.version),
    description: str(raw.description),
    hasHooks: isRecord(raw.hooks) && Object.keys(raw.hooks).length > 0,
  }
}

/**
 * Read Claude's `installed_plugins.json`.
 *
 * Keys are `plugin@marketplace` and each holds the install records for that
 * plugin — one per scope. The newest install wins, which is the one Claude
 * loads.
 */
export function parseClaudeInstalls(
  raw: unknown,
): Array<{ name: string; marketplace: string; installPath: string; version: string }> {
  if (!isRecord(raw) || !isRecord(raw.plugins)) return []
  const out: Array<{ name: string; marketplace: string; installPath: string; version: string }> = []
  for (const [key, value] of Object.entries(raw.plugins)) {
    if (!Array.isArray(value) || value.length === 0) continue
    const at = key.lastIndexOf('@')
    const name = at > 0 ? key.slice(0, at) : key
    const marketplace = at > 0 ? key.slice(at + 1) : ''
    const newest = value
      .filter(isRecord)
      .sort((a, b) => str(b.installedAt).localeCompare(str(a.installedAt)))[0]
    const installPath = newest ? str(newest.installPath) : ''
    if (!installPath) continue
    out.push({ name, marketplace, installPath, version: str(newest?.version) })
  }
  return out
}

/** Entries in an `.agents/plugins/marketplace.json`, for locally rooted plugins. */
export function parseAgentsMarketplace(raw: unknown): Array<{ name: string; path: string }> {
  if (!isRecord(raw) || !Array.isArray(raw.plugins)) return []
  const out: Array<{ name: string; path: string }> = []
  for (const entry of raw.plugins) {
    if (!isRecord(entry)) continue
    const name = str(entry.name).trim()
    const path = str(entry.path).trim()
    if (name && path) out.push({ name, path })
  }
  return out
}
