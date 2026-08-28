/**
 * The shared MCP registry: `~/.openrun/mcp.json`, projected into every CLI.
 *
 * `server/mcp.ts` edits one config file at a time — this module owns the list
 * that gets copied into all of them, plus the record of which copies it made.
 * The rules it decides with are in `lib/mcpShared.ts` (pure, tested); the file
 * IO and the per-target write are `server/mcp.ts`'s.
 *
 * The same file is the ACP protocol target, so an agent driven over ACP is
 * handed these servers in `session/new` without any config file at all.
 */
import {
  mcpServerEntryToJson,
  parseMcpServersMap,
  resolveJsonPointer,
  assertMcpServer,
  type McpServerConfig,
} from '../lib/mcp.ts'
import {
  groupDiscovered,
  needsSharedWrite,
  sharedSyncRefusal,
  sharedSyncState,
  type DiscoveredServer,
  type DiscoveredVariant,
  type SharedSyncState,
} from '../lib/mcpShared.ts'
import { SHARED_MCP_TARGETS, transportRefusal } from '../lib/mcpTargets.ts'
import {
  deleteServer,
  readJsonDoc,
  resolveTarget,
  writeAtomic,
  writeServer,
  type ResolvedMcpTarget,
} from './mcp.ts'
import { openrunHome } from './db.ts'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Whether this CLI is set up on the machine at all.
 *
 * Fanning a server into `~/.codex/config.toml` on a machine with no Codex
 * would conjure a config for a tool the user never installed, so an absent CLI
 * is skipped and picked up by the next sync once it appears.
 */
function isInstalled(target: ResolvedMcpTarget): boolean {
  const probes = target.presence
  if (!probes || probes.length === 0) return true
  return probes.some((probe) => existsSync(join(homedir(), probe)))
}

/** Where the shared list lives — the same file `openrun-acp` reads. */
export function sharedMcpFile(): string {
  return join(openrunHome(), 'mcp.json')
}

/** Names Open Run wrote into a given CLI config, keyed by target id. */
type ManagedIndex = Record<string, string[]>

type SharedDoc = {
  raw: Record<string, unknown>
  servers: McpServerConfig[]
  managed: ManagedIndex
}

function readManaged(doc: Record<string, unknown>): ManagedIndex {
  const openrun = doc.openrun
  if (!openrun || typeof openrun !== 'object' || Array.isArray(openrun)) return {}
  const managed = (openrun as Record<string, unknown>).managed
  if (!managed || typeof managed !== 'object' || Array.isArray(managed)) return {}
  const out: ManagedIndex = {}
  for (const [targetId, value] of Object.entries(managed as Record<string, unknown>)) {
    if (Array.isArray(value))
      out[targetId] = value.filter((v): v is string => typeof v === 'string')
  }
  return out
}

/**
 * `disabled` is Open Run's own bookkeeping, not a key any host agrees on, so
 * it rides alongside the entry here and is read back the same way. Losing it
 * would quietly re-enable a server the user had switched off.
 */
function readDisabled(node: unknown, name: string): boolean {
  if (!node || typeof node !== 'object') return false
  const entry = (node as Record<string, unknown>)[name]
  return (
    !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).disabled === true
  )
}

function readSharedDoc(): SharedDoc {
  const raw = readJsonDoc(sharedMcpFile()) ?? {}
  const node = resolveJsonPointer(raw, ['mcpServers'], false)
  const servers = node ? parseMcpServersMap(node) : []
  for (const server of servers) {
    if (readDisabled(node, server.name)) server.disabled = true
  }
  return { raw, servers, managed: readManaged(raw) }
}

function writeSharedDoc(doc: SharedDoc): void {
  const servers = resolveJsonPointer(doc.raw, ['mcpServers'], true)
  if (!servers) throw new Error(`${sharedMcpFile()} already has a non-object at "mcpServers"`)
  for (const key of Object.keys(servers)) delete servers[key]
  for (const server of doc.servers) {
    servers[server.name] = {
      ...mcpServerEntryToJson(server),
      ...(server.disabled ? { disabled: true } : {}),
    }
  }

  const openrun = resolveJsonPointer(doc.raw, ['openrun'], true)
  if (!openrun) throw new Error(`${sharedMcpFile()} already has a non-object at "openrun"`)
  const managed: ManagedIndex = {}
  for (const [targetId, names] of Object.entries(doc.managed)) {
    if (names.length > 0) managed[targetId] = [...new Set(names)].sort()
  }
  openrun.managed = managed

  writeAtomic(sharedMcpFile(), `${JSON.stringify(doc.raw, null, 2)}\n`)
}

function isManaged(managed: ManagedIndex, targetId: string, name: string): boolean {
  return (managed[targetId] ?? []).includes(name)
}

function markManaged(managed: ManagedIndex, targetId: string, name: string): void {
  const names = new Set(managed[targetId] ?? [])
  names.add(name)
  managed[targetId] = [...names]
}

function unmarkManaged(managed: ManagedIndex, targetId: string, name: string): void {
  managed[targetId] = (managed[targetId] ?? []).filter((n) => n !== name)
}

export type SharedTargetState = {
  targetId: string
  label: string
  file: string
  state: SharedSyncState
  /** False when this CLI is not set up here, so nothing will be written to it. */
  installed: boolean
  /** Set when the CLI already has this name and Open Run did not put it there. */
  refusal?: string
}

export type SharedMcpServerView = {
  server: McpServerConfig
  targets: SharedTargetState[]
}

export type SharedMcpTargetInfo = {
  id: string
  label: string
  file: string
  description: string
  /** False when this CLI is not set up on the machine. */
  installed: boolean
  /** Set when the file cannot be read (invalid JSON, say). */
  refusal?: string
}

export type SharedMcpView = {
  file: string
  servers: SharedMcpServerView[]
  targets: SharedMcpTargetInfo[]
  /** True when a sync has writes to make. Settled states do not count. */
  outOfSync: boolean
  /** True when a name clash is blocking at least one write. */
  conflicted: boolean
}

/**
 * A write a sync would actually make. An uninstalled CLI reads as `missing`
 * for ever — counting it would pin the page to "out of sync" and leave the
 * Sync button doing nothing.
 */
function pendingWrite(state: SharedTargetState): boolean {
  return state.installed && needsSharedWrite(state.state)
}

function resolvedTargets(): ResolvedMcpTarget[] {
  return SHARED_MCP_TARGETS.map((target) => resolveTarget(target))
}

function stateFor(
  target: ResolvedMcpTarget,
  server: McpServerConfig,
  managed: ManagedIndex,
): SharedTargetState {
  const present = target.servers.find((s) => s.name === server.name)
  const unsupported = transportRefusal(target, server.transport)
  const state = sharedSyncState({
    shared: server,
    present,
    managed: isManaged(managed, target.id, server.name),
    ...(unsupported ? { unsupported: true } : {}),
  })
  const refusal =
    unsupported ?? sharedSyncRefusal({ state, targetLabel: target.label, file: target.file })
  return {
    targetId: target.id,
    label: target.label,
    file: target.file,
    state,
    installed: isInstalled(target),
    ...(refusal ? { refusal } : {}),
  }
}

export function getSharedMcp(): SharedMcpView {
  const doc = readSharedDoc()
  const targets = resolvedTargets()
  const servers = doc.servers.map((server) => ({
    server,
    targets: targets.map((target) => stateFor(target, server, doc.managed)),
  }))
  return {
    file: sharedMcpFile(),
    servers,
    targets: targets.map((t) => ({
      id: t.id,
      label: t.label,
      file: t.file,
      description: t.description,
      installed: isInstalled(t),
      ...(t.refusal ? { refusal: t.refusal } : {}),
    })),
    outOfSync: servers.some((s) => s.targets.some(pendingWrite)),
    conflicted: servers.some((s) => s.targets.some((t) => t.installed && t.state === 'conflict')),
  }
}

export type SharedWriteReport = {
  /** Target ids the server was written to. */
  written: string[]
  /** Targets left alone, with why. */
  skipped: { targetId: string; reason: string }[]
}

/**
 * Push one shared server into every CLI config.
 *
 * A conflict — the CLI already has that name from somewhere else — is skipped
 * rather than overwritten unless `force` says otherwise, so a hand-written
 * server is never silently replaced.
 */
function fanOut(
  server: McpServerConfig,
  doc: SharedDoc,
  options: { previousName?: string; force?: boolean; claimSynced?: boolean },
): SharedWriteReport {
  const report: SharedWriteReport = { written: [], skipped: [] }
  for (const target of resolvedTargets()) {
    if (target.refusal) {
      report.skipped.push({ targetId: target.id, reason: target.refusal })
      continue
    }
    if (!isInstalled(target)) {
      report.skipped.push({ targetId: target.id, reason: `${target.label} is not set up here` })
      continue
    }
    const state = stateFor(target, server, doc.managed)
    if (state.state === 'unsupported' || state.state === 'off') {
      report.skipped.push({ targetId: target.id, reason: state.refusal ?? 'Turned off' })
      continue
    }
    if (state.state === 'conflict' && !options.force) {
      report.skipped.push({ targetId: target.id, reason: state.refusal ?? 'Name already taken' })
      continue
    }
    const renamed = options.previousName && options.previousName !== server.name
    if (state.state === 'synced' && !renamed) {
      // On import the CLI's copy is the user's own — claiming it would let a
      // later "remove everywhere" delete the entry they started with.
      if (options.claimSynced !== false) markManaged(doc.managed, target.id, server.name)
      continue
    }
    try {
      writeServer(target, server, {
        ...(renamed ? { previousName: options.previousName as string } : {}),
      })
    } catch (err) {
      report.skipped.push({ targetId: target.id, reason: String(err) })
      continue
    }
    if (renamed) unmarkManaged(doc.managed, target.id, options.previousName as string)
    markManaged(doc.managed, target.id, server.name)
    report.written.push(target.id)
  }
  return report
}

export function saveSharedMcpServer(input: {
  server: McpServerConfig
  previousName?: string
  force?: boolean
}): SharedWriteReport {
  assertMcpServer(input.server)
  const doc = readSharedDoc()
  const previous = input.previousName?.trim()

  const kept = doc.servers.filter(
    (s) => s.name !== input.server.name && (!previous || s.name !== previous),
  )
  doc.servers = [...kept, input.server].sort((a, b) => a.name.localeCompare(b.name))

  const report = fanOut(input.server, doc, {
    ...(previous ? { previousName: previous } : {}),
    ...(input.force ? { force: true } : {}),
  })
  writeSharedDoc(doc)
  return report
}

/**
 * Drop a shared server.
 *
 * `registry` forgets it here and leaves every CLI exactly as it is — the right
 * default for a server that was imported, since the copy in the CLI it came
 * from is the user's, not ours. `everywhere` also deletes the copies Open Run
 * made, and never one it did not.
 */
export function removeSharedMcpServer(input: {
  name: string
  scope?: 'registry' | 'everywhere'
}): SharedWriteReport {
  const doc = readSharedDoc()
  doc.servers = doc.servers.filter((s) => s.name !== input.name)

  const report: SharedWriteReport = { written: [], skipped: [] }
  if (input.scope === 'registry') {
    for (const targetId of Object.keys(doc.managed))
      unmarkManaged(doc.managed, targetId, input.name)
    writeSharedDoc(doc)
    return report
  }
  for (const target of resolvedTargets()) {
    if (!isManaged(doc.managed, target.id, input.name)) {
      report.skipped.push({ targetId: target.id, reason: 'Open Run did not add it here' })
      continue
    }
    if (target.refusal) {
      report.skipped.push({ targetId: target.id, reason: target.refusal })
      continue
    }
    try {
      deleteServer(target, input.name)
    } catch (err) {
      report.skipped.push({ targetId: target.id, reason: String(err) })
      continue
    }
    unmarkManaged(doc.managed, target.id, input.name)
    report.written.push(target.id)
  }
  writeSharedDoc(doc)
  return report
}

// --- Import: adopt what the user already had --------------------------------

export type McpDiscovery = {
  servers: DiscoveredServer[]
  /** CLIs that were scanned, so an empty result can say what it looked at. */
  scanned: { targetId: string; label: string; file: string; installed: boolean }[]
}

/**
 * Every server in a CLI config that the shared list does not already hold.
 *
 * Read-only. A new user has years of MCP servers spread across four configs
 * and none of them in Open Run; this is what the import screen offers, and
 * nothing moves until they choose.
 */
export function discoverMcpServers(): McpDiscovery {
  const doc = readSharedDoc()
  const known = new Set(doc.servers.map((s) => s.name))
  const targets = resolvedTargets()
  const variants: DiscoveredVariant[] = []

  for (const target of targets) {
    if (target.refusal || !isInstalled(target)) continue
    for (const server of target.servers) {
      if (known.has(server.name)) continue
      variants.push({
        targetId: target.id,
        targetLabel: target.label,
        file: target.file,
        server,
      })
    }
  }

  return {
    servers: groupDiscovered(variants),
    scanned: targets.map((t) => ({
      targetId: t.id,
      label: t.label,
      file: t.file,
      installed: isInstalled(t),
    })),
  }
}

export type ImportChoice = {
  name: string
  /** Which CLI's copy to take, for a name that differs between them. */
  fromTargetId: string
}

export type ImportReport = {
  imported: string[]
  /** Names that could not be taken, with why. */
  skipped: { name: string; reason: string }[]
  fanOut: SharedWriteReport
}

/**
 * Adopt chosen servers into the shared list, then push them to the CLIs that
 * do not have them yet.
 *
 * The CLI a server came from already has it, so that target ends up `synced`
 * without a write — importing is additive everywhere and rewrites nothing the
 * user already had.
 */
export function importMcpServers(input: { choices: ImportChoice[] }): ImportReport {
  const discovery = discoverMcpServers()
  const doc = readSharedDoc()
  const report: ImportReport = { imported: [], skipped: [], fanOut: { written: [], skipped: [] } }

  for (const choice of input.choices) {
    const found = discovery.servers.find((s) => s.name === choice.name)
    if (!found) {
      report.skipped.push({ name: choice.name, reason: 'No longer on disk' })
      continue
    }
    const variant =
      found.variants.find((v) => v.targetId === choice.fromTargetId) ?? found.variants[0]
    if (!variant) {
      report.skipped.push({ name: choice.name, reason: 'No copy to take' })
      continue
    }
    if (doc.servers.some((s) => s.name === choice.name)) {
      report.skipped.push({ name: choice.name, reason: 'Already shared' })
      continue
    }
    doc.servers.push(variant.server)
    report.imported.push(choice.name)
  }

  doc.servers.sort((a, b) => a.name.localeCompare(b.name))

  for (const name of report.imported) {
    const server = doc.servers.find((s) => s.name === name)
    if (!server) continue
    const one = fanOut(server, doc, { claimSynced: false })
    report.fanOut.written.push(...one.written)
    report.fanOut.skipped.push(...one.skipped)
  }

  writeSharedDoc(doc)
  return report
}

/** Re-project every shared server, repairing anything edited on disk since. */
export function syncSharedMcp(input: { force?: boolean } = {}): SharedWriteReport {
  const doc = readSharedDoc()
  const report: SharedWriteReport = { written: [], skipped: [] }
  for (const server of doc.servers) {
    const one = fanOut(server, doc, { ...(input.force ? { force: true } : {}) })
    report.written.push(...one.written)
    report.skipped.push(...one.skipped)
  }
  writeSharedDoc(doc)
  return report
}

/** Whether a sync has anything to do — drives the button's enabled state. */
export function sharedMcpNeedsSync(view: SharedMcpView): boolean {
  return view.servers.some((s) => s.targets.some(pendingWrite))
}
