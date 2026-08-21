/**
 * Read and write MCP servers in the CLI's own config file.
 *
 * The formats are the agents' own and can move under us on a CLI upgrade, so
 * everything that knows a shape lives in `lib/mcp.ts` (pure, tested) and this
 * module only resolves paths and touches the disk. Writes go through a temp
 * file + rename so a crash mid-write cannot leave the user with a truncated
 * `~/.claude.json`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertMcpServer,
  mcpServerEntryToJson,
  parseMcpServersMap,
  parseTomlMcpServers,
  removeTomlMcpServer,
  resolveJsonPointer,
  upsertTomlMcpServer,
  type McpServerConfig,
} from '../lib/mcp.ts'
import {
  isProtocolTarget,
  mcpTargetsFor,
  transportRefusal,
  type McpTarget,
} from '../lib/mcpTargets.ts'
import { OPENRUN_MCP_SERVER_NAME } from '../lib/openrunTools.ts'
import { openrunHome } from './db.ts'

export type ResolvedMcpTarget = McpTarget & {
  /** Absolute path of the config file, or '' when the scope has no cwd. */
  file: string
  exists: boolean
  servers: McpServerConfig[]
  /** Why this target cannot be edited right now (no workspace, unreadable). */
  refusal?: string
}

/**
 * Servers Claude reads from a workspace `.mcp.json` are inert until the user
 * approves them, and a headless run has nobody to ask. Writing the name into
 * this list in `~/.claude.json` is the same record the interactive approval
 * leaves behind, so a server added here works on the next unattended run.
 */
const CLAUDE_APPROVAL_FILE = '.claude.json'

/**
 * Grok refuses to start a workspace-scoped server until the folder is trusted,
 * and the only other way to record that is `/hooks-trust` inside its TUI. A
 * server saved from here is an explicit instruction to use it, so Open Run
 * writes the same record the TUI would.
 */
const GROK_TRUST_FILE = '.grok/trusted_folders.toml'

function absoluteFor(target: McpTarget, cwd: string): string {
  if (target.scope === 'user') return join(homedir(), target.path)
  if (target.scope === 'openrun') return join(openrunHome(), target.path)
  return cwd ? join(resolve(cwd), target.path) : ''
}

function readText(file: string): string | null {
  if (!file || !existsSync(file)) return null
  try {
    if (statSync(file).isDirectory()) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function readJsonDoc(file: string): Record<string, unknown> | null {
  const raw = readText(file)
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function writeAtomic(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.openrun-${process.pid}.tmp`
  try {
    writeFileSync(tmp, contents, 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

function readServers(target: McpTarget, file: string): McpServerConfig[] {
  if (target.format === 'toml') {
    const raw = readText(file)
    return raw === null ? [] : parseTomlMcpServers(raw, target.table)
  }
  const doc = readJsonDoc(file)
  if (!doc) return []
  const node = resolveJsonPointer(doc, target.pointer, false)
  return node ? parseMcpServersMap(node, target.dialect) : []
}

/**
 * Keep one copy of a config file as Open Run found it, before the first time
 * it changes it. These are the user's own files and a fan-out touches several
 * at once, so there has to be something to go back to that is not "restore
 * from memory".
 */
function backupOnce(file: string): void {
  const backup = `${file}.openrun-backup`
  if (!existsSync(file) || existsSync(backup)) return
  try {
    copyFileSync(file, backup)
  } catch {
    // A config we cannot copy is still one we can write; do not block the save.
  }
}

function unreadableRefusal(target: McpTarget, file: string): string | undefined {
  if (!existsSync(file)) return undefined
  if (target.format === 'toml') return undefined
  if (readJsonDoc(file) !== null) return undefined
  return `${file} is not valid JSON — fix it by hand first.`
}

/** One config file's path and current contents. */
export function resolveTarget(target: McpTarget, cwd = ''): ResolvedMcpTarget {
  const file = absoluteFor(target, cwd)
  if (!file) {
    return {
      ...target,
      file: '',
      exists: false,
      servers: [],
      refusal: 'Pick a workspace to edit its project config.',
    }
  }
  const refusal = unreadableRefusal(target, file)
  return {
    ...target,
    file,
    exists: existsSync(file),
    servers: refusal ? [] : readServers(target, file),
    ...(refusal ? { refusal } : {}),
  }
}

/** Every config file this runtime can hold MCP servers in, with their contents. */
export function resolveMcpTargets(input: {
  bin: string
  transport?: string | null
  cwd?: string
}): ResolvedMcpTarget[] {
  const cwd = input.cwd?.trim() ?? ''
  return mcpTargetsFor(input).map((target) => resolveTarget(target, cwd))
}

function targetOrThrow(
  input: { bin: string; transport?: string | null; cwd?: string },
  targetId: string,
): ResolvedMcpTarget {
  const target = resolveMcpTargets(input).find((t) => t.id === targetId)
  if (!target) throw new Error('This runtime has no such MCP config file')
  if (target.refusal) throw new Error(target.refusal)
  return target
}

/**
 * Mark a workspace `.mcp.json` server as approved for this cwd so unattended
 * Claude runs may use it. Best-effort: a machine with no `~/.claude.json` yet
 * has nothing to approve into, and failing the save over it would be worse
 * than the server simply staying dormant until Claude's own prompt.
 */
function approveClaudeProjectServer(cwd: string, name: string, approved: boolean): void {
  const file = join(homedir(), CLAUDE_APPROVAL_FILE)
  const doc = readJsonDoc(file)
  if (!doc) return
  const project = resolveJsonPointer(doc, ['projects', resolve(cwd)], true)
  if (!project) return

  const listOf = (key: string): string[] => {
    const raw = project[key]
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  }
  const enabled = new Set(listOf('enabledMcpjsonServers'))
  const disabled = new Set(listOf('disabledMcpjsonServers'))
  if (approved) {
    enabled.add(name)
    disabled.delete(name)
  } else {
    enabled.delete(name)
  }
  project.enabledMcpjsonServers = [...enabled]
  project.disabledMcpjsonServers = [...disabled]
  try {
    writeAtomic(file, `${JSON.stringify(doc, null, 2)}\n`)
  } catch {
    // The server still exists in .mcp.json; Claude will ask for it interactively.
  }
}

function trustGrokFolder(cwd: string): void {
  const dir = resolve(cwd)
  const file = join(homedir(), GROK_TRUST_FILE)
  const raw = readText(file) ?? ''
  const header = `[folders."${dir}"]`
  if (raw.split('\n').some((line) => line.trim() === header)) return
  const body = raw.replace(/\s+$/, '')
  const block = `${header}\ntrusted = true\ndecided_at = ${Math.floor(Date.now() / 1000)}`
  try {
    writeAtomic(file, `${body ? `${body}\n\n` : ''}${block}\n`)
  } catch {
    // The server is still in the config; Grok will ask on the next session.
  }
}

function writeJsonServers(
  target: ResolvedMcpTarget,
  mutate: (servers: Record<string, unknown>) => void,
): void {
  const doc = readJsonDoc(target.file) ?? {}
  const node = resolveJsonPointer(doc, target.pointer, true)
  if (!node) throw new Error(`${target.file} already has a non-object at this key`)
  backupOnce(target.file)
  mutate(node)
  writeAtomic(target.file, `${JSON.stringify(doc, null, 2)}\n`)
}

export type McpWriteInput = {
  bin: string
  transport?: string | null
  cwd?: string
  targetId: string
}

/**
 * Add or replace one server. `previousName` renames in place, so an edit that
 * changes the name does not leave the old entry behind.
 */
export function writeServer(
  target: ResolvedMcpTarget,
  server: McpServerConfig,
  options: { previousName?: string; cwd?: string } = {},
): void {
  assertMcpServer(server)
  if (target.refusal) throw new Error(target.refusal)
  const previous = options.previousName?.trim()

  const unsupported = transportRefusal(target, server.transport)
  if (unsupported) throw new Error(unsupported)

  if (target.format === 'toml') {
    const raw = readText(target.file) ?? ''
    const cleaned =
      previous && previous !== server.name ? removeTomlMcpServer(raw, previous, target.table) : raw
    backupOnce(target.file)
    writeAtomic(
      target.file,
      upsertTomlMcpServer(cleaned, server, target.table, {
        ...(target.enabledFlag ? { enabledFlag: true } : {}),
        ...(target.headerKey ? { headerKey: target.headerKey } : {}),
      }),
    )
    if (target.needsFolderTrust && options.cwd) trustGrokFolder(options.cwd)
    return
  }

  writeJsonServers(target, (servers) => {
    if (previous && previous !== server.name) delete servers[previous]
    servers[server.name] = mcpServerEntryToJson(server, target.dialect)
  })

  if (target.id === 'claude-project' && options.cwd) {
    if (previous && previous !== server.name) {
      approveClaudeProjectServer(options.cwd, previous, false)
    }
    approveClaudeProjectServer(options.cwd, server.name, true)
  }
}

export function deleteServer(target: ResolvedMcpTarget, name: string, cwd = ''): void {
  if (target.refusal) throw new Error(target.refusal)
  if (target.format === 'toml') {
    const raw = readText(target.file)
    if (raw === null) return
    backupOnce(target.file)
    writeAtomic(target.file, removeTomlMcpServer(raw, name, target.table))
    return
  }
  if (!target.exists) return
  writeJsonServers(target, (servers) => {
    delete servers[name]
  })
  if (target.id === 'claude-project' && cwd) approveClaudeProjectServer(cwd, name, false)
}

/**
 * Add or replace one server. `previousName` renames in place, so an edit that
 * changes the name does not leave the old entry behind.
 */
export function saveMcpServer(
  input: McpWriteInput & { server: McpServerConfig; previousName?: string },
): void {
  writeServer(targetOrThrow(input, input.targetId), input.server, {
    ...(input.previousName ? { previousName: input.previousName } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  })
}

export function removeMcpServer(input: McpWriteInput & { name: string }): void {
  deleteServer(targetOrThrow(input, input.targetId), input.name, input.cwd ?? '')
}

/**
 * Absolute path of Open Run's own MCP server script, or '' when this checkout
 * cannot find it.
 *
 * `process.cwd()` is the app root under both `pnpm dev` and `pnpm start` (the
 * production entry loads `dist/server/server.js` from there), and the
 * module-relative candidate covers a server bundle started from elsewhere.
 */
function openrunToolScript(): string {
  const candidates = [
    join(process.cwd(), 'scripts', 'mcp-server.ts'),
    fileURLToPath(new URL('../../scripts/mcp-server.ts', import.meta.url)),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? ''
}

/**
 * The config entry that points an agent at Open Run's own tools.
 *
 * Spawned with this process's own node binary and `--experimental-strip-types`
 * — the same way `pnpm start` runs its TypeScript entry — so there is no build
 * step between adding the server and it working.
 */
export function openrunToolServer(): McpServerConfig | null {
  const script = openrunToolScript()
  if (!script) return null
  return {
    name: OPENRUN_MCP_SERVER_NAME,
    transport: 'stdio',
    command: process.execPath,
    args: ['--experimental-strip-types', script],
  }
}

/**
 * Servers Open Run hands the agent itself in `session/new`.
 *
 * Only the protocol target: everything else in the list is a file the agent
 * reads on its own, and sending those again would register each server twice.
 */
export function protocolMcpServers(input: {
  bin: string
  transport?: string | null
  cwd?: string
}): McpServerConfig[] {
  return resolveMcpTargets(input)
    .filter(isProtocolTarget)
    .flatMap((t) => t.servers)
}
