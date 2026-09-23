/** mcp capability implementation. */
import { resolveRuntimeLabel } from '@openrun/domain/runtimes/runtimeLabel'
import type { RuntimeRow } from '../storage/db.ts'
import { getWorkspace } from '../workspaces/workspaces.ts'
import {
  openrunToolServer,
  removeMcpServer,
  resolveMcpTargets,
  saveMcpServer,
  type ResolvedMcpTarget,
} from '../mcp/mcp.ts'
import {
  discoverMcpServers,
  getSharedMcp,
  importMcpServers,
  removeSharedMcpServer,
  saveSharedMcpServer,
  syncSharedMcp,
  type ImportChoice,
  type ImportReport,
  type McpDiscovery,
  type SharedMcpView,
  type SharedWriteReport,
} from '../mcp/mcpShared.ts'
import {
  beginMcpOAuth,
  disconnectMcpOAuth,
  mcpOAuthViews,
  refreshMcpTokens,
} from '../mcp/mcpOAuth.ts'
import type { McpServerConfig } from '@openrun/domain/mcp/mcp'
import { mcpSupportRefusal } from '@openrun/domain/mcp/mcpTargets'

import { getRuntime } from './runtimes.ts'

/**
 * What the MCP page shows for one runtime: the config files its servers can
 * live in, already read, plus the reason there are none.
 *
 * Open Run has no registry of its own — these are the agent's real config
 * files, so a server added here is also there next time the user runs the CLI
 * by hand. See `lib/mcpTargets.ts`.
 */
export type McpConfigView = {
  runtime: { id: string; label: string; bin: string; transport: string }
  /** Why this runtime cannot hold MCP servers at all (unknown CLI). */
  refusal?: string
  targets: ResolvedMcpTarget[]
  /**
   * The entry that points an agent at Open Run's own run-context tools, ready
   * to write into any of the targets above. Null when the server script is
   * missing from this checkout.
   */
  openrunTools: McpServerConfig | null
}

/** Workspace path for MCP purposes — unset and half-built ones simply have none. */
function mcpCwd(workspaceId?: string): string {
  if (!workspaceId?.trim()) return ''
  return getWorkspace(workspaceId)?.path ?? ''
}

function mcpRuntime(runtimeId: string): RuntimeRow {
  const runtime = getRuntime(runtimeId)
  if (!runtime) throw new Error('Runtime not found')
  return runtime
}

export function getMcpConfig(input: { runtimeId: string; workspaceId?: string }): McpConfigView {
  const runtime = mcpRuntime(input.runtimeId)
  const refusal = mcpSupportRefusal({ bin: runtime.bin, transport: runtime.transport })
  return {
    runtime: {
      id: runtime.id,
      label: resolveRuntimeLabel(runtime.label, runtime.id),
      bin: runtime.bin,
      transport: runtime.transport,
    },
    ...(refusal ? { refusal } : {}),
    targets: resolveMcpTargets({
      bin: runtime.bin,
      transport: runtime.transport,
      cwd: mcpCwd(input.workspaceId),
    }),
    openrunTools: openrunToolServer(),
  }
}

export function saveMcpServerConfig(input: {
  runtimeId: string
  workspaceId?: string
  targetId: string
  server: McpServerConfig
  previousName?: string
}): McpConfigView {
  const runtime = mcpRuntime(input.runtimeId)
  saveMcpServer({
    bin: runtime.bin,
    transport: runtime.transport,
    cwd: mcpCwd(input.workspaceId),
    targetId: input.targetId,
    server: input.server,
    ...(input.previousName ? { previousName: input.previousName } : {}),
  })
  return getMcpConfig(input)
}

export function removeMcpServerConfig(input: {
  runtimeId: string
  workspaceId?: string
  targetId: string
  name: string
}): McpConfigView {
  const runtime = mcpRuntime(input.runtimeId)
  removeMcpServer({
    bin: runtime.bin,
    transport: runtime.transport,
    cwd: mcpCwd(input.workspaceId),
    targetId: input.targetId,
    name: input.name,
  })
  return getMcpConfig(input)
}

/**
 * Shared MCP servers: defined once here, written into every CLI's machine-wide
 * config. See `server/mcpShared.ts` for the ownership rules.
 */
export function getSharedMcpConfig(): SharedMcpView {
  return getSharedMcp()
}

export function saveSharedMcpServerConfig(input: {
  server: McpServerConfig
  previousName?: string
  force?: boolean
}): { view: SharedMcpView; report: SharedWriteReport } {
  const report = saveSharedMcpServer(input)
  return { view: getSharedMcp(), report }
}

export function discoverMcpServersConfig(): McpDiscovery {
  return discoverMcpServers()
}

export function importMcpServersConfig(input: { choices: ImportChoice[] }): {
  view: SharedMcpView
  discovery: McpDiscovery
  report: ImportReport
} {
  const report = importMcpServers(input)
  return { view: getSharedMcp(), discovery: discoverMcpServers(), report }
}

export function removeSharedMcpServerConfig(input: {
  name: string
  scope?: 'registry' | 'everywhere'
}): {
  view: SharedMcpView
  report: SharedWriteReport
} {
  const report = removeSharedMcpServer(input)
  return { view: getSharedMcp(), report }
}

export function syncSharedMcpConfig(input: { force?: boolean } = {}): {
  view: SharedMcpView
  report: SharedWriteReport
} {
  const report = syncSharedMcp(input)
  return { view: getSharedMcp(), report }
}

/**
 * OAuth for a hosted MCP server, run once here instead of once per CLI. The
 * token lands in every CLI config as an Authorization header — see
 * `server/mcpOAuth.ts`.
 */
export async function getMcpOAuthStatus(): Promise<{
  connections: ReturnType<typeof mcpOAuthViews>
  errors: string[]
}> {
  const { errors } = await refreshMcpTokens()
  return { connections: mcpOAuthViews(), errors }
}

export function startMcpOAuth(input: { name: string; redirectUri: string }) {
  return beginMcpOAuth(input)
}

export async function disconnectMcpServer(input: { name: string }): Promise<{
  view: SharedMcpView
  report: SharedWriteReport
  connections: ReturnType<typeof mcpOAuthViews>
}> {
  const report = await disconnectMcpOAuth(input)
  return { view: getSharedMcp(), report, connections: mcpOAuthViews() }
}

// Internal collaborators; the public facade exports only the API surface.
export { mcpCwd }
