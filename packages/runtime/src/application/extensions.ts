/** extensions capability implementation. */
import { listSlashCommands, type SlashCommandListing } from '../runtimes/slashCommands.ts'
import { listAllPlugins, listPlugins } from '../runtimes/plugins.ts'
import type { PluginHost, PluginListing } from '@openrun/domain/runtimes/plugins'
import { APP_SLASH_COMMANDS } from '@openrun/domain/chat/slashCommands'
import { getRuntime } from './runtimes.ts'
import { mcpCwd } from './mcp.ts'

/**
 * Commands the composer can offer for a runtime: the CLI's own command files
 * plus, in a live chat, the ones Open Run answers itself.
 *
 * `includeApp` is false for an automation's prompt: `/clear` and `/stop` need
 * a conversation and a human, neither of which an unattended run has.
 */
export function listSlashCommandsFor(input: {
  runtimeId: string
  workspaceId?: string
  includeApp?: boolean
}): SlashCommandListing {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) return { commands: [] }
  const listing = listSlashCommands({ bin: runtime.bin, cwd: mcpCwd(input.workspaceId) })
  if (!input.includeApp) return listing
  return { ...listing, commands: [...APP_SLASH_COMMANDS, ...listing.commands] }
}

/**
 * Plugins the runtime's CLI already has installed, for the composer's `$` menu
 * and the MCP page. Read-only — installing one is the CLI's own command.
 */
export function listPluginsFor(input: { runtimeId: string; workspaceId?: string }): PluginListing {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) return { plugins: [] }
  return listPlugins({ bin: runtime.bin, cwd: mcpCwd(input.workspaceId) })
}

/** Every plugin on the machine, grouped by the CLI that owns it. */
export function listInstalledPlugins(input: {
  workspaceId?: string
}): Record<PluginHost, PluginListing> {
  return listAllPlugins({ cwd: mcpCwd(input.workspaceId) })
}
