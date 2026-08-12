/**
 * Classify a tool call as an ordinary tool, an MCP call, a skill invocation,
 * or a sub-agent spawn — so chat can render each with its own chrome.
 *
 * ACP only has `ToolKind` (read/edit/execute/…). That is the right axis for
 * "what did the bytes do", but not for "where did this call come from". Claude
 * names MCP tools `mcp__server__tool`, invokes skills via a `Skill` tool, and
 * spawns sub-agents via `Task` / `Agent`. Codex has an explicit
 * `mcp_tool_call` item. This module turns those signals into a small role
 * enum that the transcript can style independently.
 *
 * Lives in `lib/` so the browser form and the server write path share one
 * classifier — old rows without `callRole` still classify correctly on read.
 */

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Where a tool call came from, for chat chrome (not ACP ToolKind). */
export type ToolCallRole = 'tool' | 'mcp' | 'skill' | 'subagent'

export const TOOL_CALL_ROLES: readonly ToolCallRole[] = [
  'tool',
  'mcp',
  'skill',
  'subagent',
]

export function isToolCallRole(value: unknown): value is ToolCallRole {
  return typeof value === 'string' && (TOOL_CALL_ROLES as readonly string[]).includes(value)
}

/** Parsed pieces of a Claude-style `mcp__server__tool` name. */
export type McpToolParts = {
  server: string
  tool: string
}

/**
 * Split `mcp__server__tool` (and the plugin form `mcp__plugin_…__tool`) into
 * a server label and a bare tool name. Returns null when the name is not MCP.
 */
export function parseMcpToolName(name: string | undefined): McpToolParts | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed.toLowerCase().startsWith('mcp__')) return null
  const rest = trimmed.slice('mcp__'.length)
  const sep = rest.lastIndexOf('__')
  if (sep <= 0 || sep === rest.length - 2) {
    return { server: rest || 'mcp', tool: rest || 'tool' }
  }
  return {
    server: rest.slice(0, sep) || 'mcp',
    tool: rest.slice(sep + 2) || 'tool',
  }
}

function inputRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

/** Skill id / name from a Skill tool's input, when present. */
export function skillNameFromInput(input: unknown): string | undefined {
  const obj = inputRecord(input)
  if (!obj) return undefined
  return pickString(obj, 'skill', 'skill_name', 'skillName', 'name')
}

/** Human bits from a Task / Agent sub-agent spawn. */
export function subagentMetaFromInput(input: unknown): {
  description?: string
  subagentType?: string
} {
  const obj = inputRecord(input)
  if (!obj) return {}
  return {
    description: pickString(obj, 'description', 'title', 'name'),
    subagentType: pickString(
      obj,
      'subagent_type',
      'subagentType',
      'agent',
      'agent_type',
      'agentType',
      'type',
    ),
  }
}

export type ClassifyToolCallHints = {
  /** Codex (and similar) item type, e.g. `mcp_tool_call`. */
  itemType?: string
  /** Explicit MCP server name when the envelope carries one. */
  mcpServer?: string
}

/**
 * Resolve the chat role for a stored call. Prefers the persisted `callRole`
 * (new rows); falls back to classifying the tool name so older transcripts
 * still get MCP / skill / sub-agent chrome.
 */
export function resolveCallRole(input: {
  callRole?: string
  name?: string
  toolInput?: unknown
  mcpServer?: string
}): ToolCallRole {
  if (isToolCallRole(input.callRole)) return input.callRole
  return classifyToolCall(input.name, input.toolInput, {
    ...(input.mcpServer ? { mcpServer: input.mcpServer } : {}),
  })
}

/**
 * Decide the chat role for a tool call.
 *
 * Order matters: an explicit Codex `mcp_tool_call` wins over name heuristics;
 * Skill / Task / Agent names win over the MCP prefix (they never collide in
 * practice, but the named tools are more specific).
 */
export function classifyToolCall(
  name: string | undefined,
  _input?: unknown,
  hints?: ClassifyToolCallHints,
): ToolCallRole {
  const itemType = (hints?.itemType ?? '').toLowerCase()
  if (itemType === 'mcp_tool_call' || itemType === 'mcp') return 'mcp'
  if (hints?.mcpServer) return 'mcp'

  const n = (name ?? '').trim().toLowerCase()
  if (!n) return 'tool'

  if (n === 'skill' || n === 'invoke_skill' || n === 'skills') return 'skill'
  if (
    n === 'task' ||
    n === 'agent' ||
    n === 'subagent' ||
    n === 'spawn_agent' ||
    n === 'tasktool'
  ) {
    return 'subagent'
  }

  if (parseMcpToolName(name)) return 'mcp'
  if (n.startsWith('mcp_') || n.startsWith('mcp.')) return 'mcp'

  return 'tool'
}

/**
 * One-line title tuned per role. Falls back to `fallback` when the role has
 * nothing better to say (callers pass the existing ACP-style title).
 */
export function toolCallRoleTitle(
  role: ToolCallRole,
  name: string | undefined,
  input: unknown,
  opts?: { mcpServer?: string; fallback?: string },
): string {
  if (role === 'mcp') {
    const parts = parseMcpToolName(name)
    const server = opts?.mcpServer || parts?.server
    const tool = parts?.tool || name || 'tool'
    if (server && tool) return `${server} · ${tool}`
    return tool
  }
  if (role === 'skill') {
    const skill = skillNameFromInput(input) || name || 'skill'
    return skill
  }
  if (role === 'subagent') {
    const meta = subagentMetaFromInput(input)
    if (meta.description && meta.subagentType) {
      return `${meta.subagentType} · ${meta.description}`
    }
    return meta.description || meta.subagentType || name || 'subagent'
  }
  return opts?.fallback || name || 'tool'
}

/**
 * Build the optional payload fields every adapter should attach to a tool
 * start/result so chat can style MCP / skill / sub-agent calls without
 * re-parsing names.
 */
export function toolCallRoleFields(
  name: string | undefined,
  input: unknown,
  hints?: ClassifyToolCallHints,
): { callRole: ToolCallRole; mcpServer?: string; titleDetail: string } {
  const callRole = classifyToolCall(name, input, hints)
  const mcpParts = callRole === 'mcp' ? parseMcpToolName(name) : null
  const mcpServer = hints?.mcpServer || mcpParts?.server
  const titleDetail = (() => {
    if (callRole === 'mcp') {
      return mcpParts?.tool || name || ''
    }
    if (callRole === 'skill') {
      return skillNameFromInput(input) || ''
    }
    if (callRole === 'subagent') {
      const meta = subagentMetaFromInput(input)
      return meta.description || meta.subagentType || ''
    }
    return ''
  })()
  return {
    callRole,
    ...(mcpServer ? { mcpServer } : {}),
    titleDetail,
  }
}
