/**
 * Open Run's own MCP server.
 *
 * The agent spawns this process (see the `openrun` entry the MCP page writes
 * into the CLI's config) and talks to it over stdio with newline-delimited
 * JSON-RPC — the Model Context Protocol's stdio transport. It answers three
 * read-only tools about the run it is executing inside; `OPENRUN_RUN_ID` in
 * the environment says which run that is, and the executor sets it on every
 * agent process so the CLI passes it down here.
 *
 * Written against the wire format directly rather than an SDK: the surface is
 * `initialize` / `tools/list` / `tools/call`, and a dependency that ships its
 * own transport would be more code than it saves.
 *
 * Anything printed on stdout that is not a JSON-RPC message corrupts the
 * stream, so diagnostics go to stderr.
 */
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  NO_APP_DIR_MESSAGE,
  OPENRUN_APP_DIR_ENV,
  OPENRUN_RUN_ID_ENV,
  OPENRUN_TOOLS,
  type OpenrunToolDef,
} from '../src/lib/openrunTools.ts'
import { callOpenrunTool } from '../src/server/openrunTools.ts'

/**
 * The agent spawned us inside the worktree, and the database path is resolved
 * from the working directory — so move to Open Run's own directory first, and
 * refuse to answer rather than create an empty database in the user's repo.
 */
function enterAppDir(): boolean {
  const dir = process.env[OPENRUN_APP_DIR_ENV] ?? ''
  if (!dir || !existsSync(dir)) return false
  try {
    process.chdir(dir)
    return true
  } catch {
    return false
  }
}

const configured = enterAppDir()

/** Protocol revision we implement; a client asking for another gets ours back. */
const PROTOCOL_VERSION = '2025-06-18'

type JsonRpcId = string | number | null

type JsonRpcMessage = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: JsonRpcId, result: Record<string, unknown>): void {
  write({ jsonrpc: '2.0', id, result })
}

function replyError(id: JsonRpcId, code: number, message: string): void {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

function toolListEntry(tool: OpenrunToolDef): Record<string, unknown> {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }
}

function handleToolCall(id: JsonRpcId, params: Record<string, unknown>): void {
  const name = typeof params.name === 'string' ? params.name : ''
  const rawArgs = params.arguments
  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {}

  if (!configured) {
    reply(id, {
      content: [{ type: 'text', text: NO_APP_DIR_MESSAGE }],
      structuredContent: { error: NO_APP_DIR_MESSAGE },
      isError: true,
    })
    return
  }

  let result: ReturnType<typeof callOpenrunTool>
  try {
    result = callOpenrunTool({ name, args, runId: process.env[OPENRUN_RUN_ID_ENV] ?? '' })
  } catch (err) {
    // A thrown handler is still a tool failure, not a protocol failure: report
    // it in the result so the agent can read it and carry on.
    const message = err instanceof Error ? err.message : String(err)
    result = { text: message, data: { error: message }, isError: true }
  }

  reply(id, {
    content: [{ type: 'text', text: result.text }],
    structuredContent: result.data,
    ...(result.isError ? { isError: true } : {}),
  })
}

function handle(message: JsonRpcMessage): void {
  const { method, params = {} } = message
  const id = message.id ?? null

  // Notifications carry no id and expect no response.
  if (message.id === undefined) return

  if (method === 'initialize') {
    const requested = params.protocolVersion
    reply(id, {
      protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'openrun', version: '1.0.0' },
      instructions:
        'Tools describing the Open Run run you are executing inside: why it started, what it has changed, and how earlier runs of the same automation went.',
    })
    return
  }

  if (method === 'ping') {
    reply(id, {})
    return
  }

  if (method === 'tools/list') {
    reply(id, { tools: OPENRUN_TOOLS.map(toolListEntry) })
    return
  }

  if (method === 'tools/call') {
    handleToolCall(id, params)
    return
  }

  replyError(id, -32601, `Method not found: ${method ?? '(none)'}`)
}

const rl = createInterface({ input: process.stdin })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message: JsonRpcMessage
  try {
    message = JSON.parse(trimmed) as JsonRpcMessage
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  try {
    handle(message)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[openrun-mcp] ${detail}\n`)
    if (message.id !== undefined) replyError(message.id ?? null, -32603, detail)
  }
})

rl.on('close', () => process.exit(0))
