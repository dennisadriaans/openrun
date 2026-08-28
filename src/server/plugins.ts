/**
 * Discover the plugins a runtime already has installed.
 *
 * Same contract as `server/slashCommands.ts`: each CLI keeps its plugins in a
 * well-known place and loads them itself, so Open Run reads those directories
 * to offer what exists. It never writes here — an install is
 * `codex plugin add` or Claude's `/plugin`, and a bundle Open Run planted
 * behind the CLI's back would not survive the CLI's own bookkeeping.
 *
 * The layouts are the CLIs' own and can change on an upgrade, so parsing lives
 * in `lib/plugins.ts` (pure, tested) and this module only walks the tree.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { modelKindForBin } from '../lib/models.ts'
import {
  parseAgentsMarketplace,
  parseClaudeInstalls,
  parseClaudePluginManifest,
  parseCodexApps,
  parseCodexPluginManifest,
  pluginHostForKind,
  type AgentPlugin,
  type PluginCapability,
  type PluginHost,
  type PluginListing,
} from '../lib/plugins.ts'

/** Guardrail against a marketplace root that turns out to be a huge tree. */
const MAX_PLUGINS = 200

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

function dirsIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((entry) => !entry.startsWith('.'))
  } catch {
    return []
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Skill directories under `<plugin>/skills/`, in the order the host lists them. */
function skillsIn(pluginDir: string): string[] {
  const root = join(pluginDir, 'skills')
  if (!isDir(root)) return []
  return dirsIn(root)
    .filter((name) => existsSync(join(root, name, 'SKILL.md')))
    .sort()
}

function withCapability(
  capabilities: PluginCapability[],
  capability: PluginCapability,
  present: boolean,
): void {
  if (present && !capabilities.includes(capability)) capabilities.push(capability)
}

// --- Codex ------------------------------------------------------------------

/**
 * The newest version directory of an installed Codex plugin.
 *
 * A plugin's cache entry holds one directory per installed version plus the
 * remote-install marker, and the CLI runs the newest. Version strings are not
 * always plain semver (`0.1.10-5f7cd798dc99`), so mtime decides rather than a
 * comparison this module would have to keep in sync with the CLI's.
 */
function newestCodexVersion(pluginDir: string): string {
  const versions = dirsIn(pluginDir)
    .map((name) => join(pluginDir, name))
    .filter((path) => existsSync(join(path, '.codex-plugin', 'plugin.json')))
  if (versions.length === 0) return ''
  versions.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return versions[0]!
}

function codexPlugin(dir: string, source: string): AgentPlugin | null {
  const raw = readJson(join(dir, '.codex-plugin', 'plugin.json'))
  const manifest = parseCodexPluginManifest(raw)
  if (!manifest) return null

  const declares = (key: string): boolean =>
    !!raw && typeof raw === 'object' && key in (raw as Record<string, unknown>)
  const apps = parseCodexApps(readJson(join(dir, '.app.json')))
  const skills = skillsIn(dir)
  const capabilities: PluginCapability[] = []
  withCapability(capabilities, 'skills', skills.length > 0)
  withCapability(capabilities, 'apps', apps.length > 0)
  withCapability(capabilities, 'mcp', declares('mcp') || existsSync(join(dir, '.mcp.json')))
  withCapability(capabilities, 'hooks', declares('hooks'))

  return {
    name: manifest.name,
    displayName: manifest.displayName,
    description: manifest.description,
    version: manifest.version,
    host: 'codex',
    source,
    path: dir,
    capabilities,
    skills,
    apps,
  }
}

/**
 * Locally rooted plugins declared in an `.agents/plugins/marketplace.json`.
 *
 * Entry paths are relative to the directory that holds `.agents`, which is why
 * `./plugins/foo` under `~/.agents/plugins/marketplace.json` means `~/plugins/foo`.
 */
function codexLocalMarketplace(file: string, out: AgentPlugin[]): void {
  const entries = parseAgentsMarketplace(readJson(file))
  if (entries.length === 0) return
  const base = dirname(dirname(dirname(file)))
  const source = file
  for (const entry of entries) {
    if (out.length >= MAX_PLUGINS) return
    const dir = resolve(base, entry.path)
    const plugin = codexPlugin(dir, source)
    if (plugin) out.push(plugin)
  }
}

function codexPlugins(cwd: string): AgentPlugin[] {
  const home = homedir()
  const out: AgentPlugin[] = []

  const cacheRoot = join(home, '.codex', 'plugins', 'cache')
  for (const marketplace of dirsIn(cacheRoot)) {
    for (const name of dirsIn(join(cacheRoot, marketplace))) {
      if (out.length >= MAX_PLUGINS) break
      const dir = newestCodexVersion(join(cacheRoot, marketplace, name))
      if (!dir) continue
      const plugin = codexPlugin(dir, marketplace)
      if (plugin) out.push(plugin)
    }
  }

  codexLocalMarketplace(join(home, '.agents', 'plugins', 'marketplace.json'), out)
  if (cwd) codexLocalMarketplace(join(cwd, '.agents', 'plugins', 'marketplace.json'), out)
  return out
}

// --- Claude Code ------------------------------------------------------------

function claudePlugins(): AgentPlugin[] {
  const home = homedir()
  const root = join(home, '.claude', 'plugins')
  const installs = parseClaudeInstalls(readJson(join(root, 'installed_plugins.json')))
  const out: AgentPlugin[] = []

  for (const install of installs) {
    if (out.length >= MAX_PLUGINS) break
    const dir = install.installPath
    const manifest = parseClaudePluginManifest(
      readJson(join(dir, '.claude-plugin', 'plugin.json')),
      install.name,
    )
    if (!manifest) continue

    const skills = skillsIn(dir)
    const capabilities: PluginCapability[] = []
    withCapability(capabilities, 'skills', skills.length > 0)
    withCapability(capabilities, 'commands', isDir(join(dir, 'commands')))
    withCapability(capabilities, 'agents', isDir(join(dir, 'agents')))
    withCapability(capabilities, 'hooks', manifest.hasHooks || isDir(join(dir, 'hooks')))
    withCapability(capabilities, 'mcp', existsSync(join(dir, '.mcp.json')))

    out.push({
      name: manifest.name,
      displayName: manifest.name,
      description: manifest.description,
      version: manifest.version || install.version,
      host: 'claude',
      source: install.marketplace,
      path: dir,
      capabilities,
      skills,
      apps: [],
    })
  }
  return out
}

// --- Listing ----------------------------------------------------------------

/**
 * How this host treats a `$name` in a prompt it was handed headlessly.
 *
 * Codex resolves mentions in the prompt text itself, so one survives
 * `codex exec`. Claude has no mention syntax — its plugins contribute skills,
 * commands and agents that the model reaches by name — so Open Run lists what
 * is installed and says the `$` is Codex's, rather than implying a guarantee.
 */
function headlessNote(host: PluginHost, count: number): string | undefined {
  if (count === 0) return undefined
  if (host === 'codex') {
    return 'Sent to `codex exec` as typed. A plugin backed by an app connector only answers if that app is already authorized in Codex.'
  }
  return 'Claude Code loads these itself — it has no `$` mention, so name the skill or command in the prompt instead.'
}

function listForHost(host: PluginHost, cwd: string): PluginListing {
  const found = host === 'codex' ? codexPlugins(cwd) : claudePlugins()
  const byName = new Map<string, AgentPlugin>()
  for (const plugin of found) if (!byName.has(plugin.name)) byName.set(plugin.name, plugin)

  const plugins = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  const note = headlessNote(host, plugins.length)
  return { plugins, ...(note ? { note } : {}) }
}

export function listPlugins(input: { bin: string; cwd?: string }): PluginListing {
  const host = pluginHostForKind(modelKindForBin(input.bin))
  if (!host) return { plugins: [] }
  return listForHost(host, input.cwd?.trim() ? resolve(input.cwd) : '')
}

/**
 * Every plugin on the machine, grouped by the CLI that owns it — what the MCP
 * page shows, where there is no single runtime in play.
 */
export function listAllPlugins(input: { cwd?: string }): Record<PluginHost, PluginListing> {
  const cwd = input.cwd?.trim() ? resolve(input.cwd) : ''
  return { codex: listForHost('codex', cwd), claude: listForHost('claude', cwd) }
}
