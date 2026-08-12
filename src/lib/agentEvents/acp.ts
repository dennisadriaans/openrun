/**
 * ACP `session/update` → turn events.
 *
 * This is the degenerate adapter: the wire format *is* the canonical model, so
 * every function here is a field rename. It exists as a separate module for two
 * reasons — it keeps `server/acpTurn.ts` free of mapping logic, and it is pure,
 * so the ACP transport's behaviour is unit-testable without spawning an agent.
 *
 * The parameter type is structural rather than the SDK's `SessionUpdate`
 * because `lib/` stays dependency-free; `lib/acpConformance.ts` is what pins
 * these field names to the real protocol.
 */
import { isToolCallStatus, isToolKind, toolKindFromName } from '../acp.ts'
import type { PlanEntry, ToolCallLocation, ToolCallStatus, ToolKind } from '../acp.ts'
import { toolCallRoleFields, toolCallRoleTitle } from '../toolCallRole.ts'
import { pickString, toolResultContent, type ParsedTurnEvent } from './types.ts'

/** The subset of an ACP session update this adapter reads. */
export type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate?: string }

/** Text out of an ACP ContentBlock (only `text` blocks carry prose). */
function contentBlockText(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  const block = content as Record<string, unknown>
  if (block.type === 'text' && typeof block.text === 'string') return block.text
  if (typeof block.type === 'string') return ''
  return ''
}

function locationsFrom(raw: unknown): ToolCallLocation[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ToolCallLocation[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const path = pickString(e, 'path')
    if (!path) continue
    out.push(typeof e.line === 'number' ? { path, line: e.line } : { path })
  }
  return out.length > 0 ? out : undefined
}

/** Flatten ToolCallContent[] into the text the transcript shows. */
function toolContentText(raw: unknown): string {
  if (!Array.isArray(raw)) return toolResultContent(raw)
  const parts: string[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (e.type === 'diff') {
      const path = pickString(e, 'path') ?? 'file'
      parts.push(`--- ${path}\n${pickString(e, 'newText') ?? ''}`)
      continue
    }
    if (e.type === 'terminal') {
      const id = pickString(e, 'terminalId')
      if (id) parts.push(`[terminal ${id}]`)
      continue
    }
    const text = contentBlockText(e.content ?? e)
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

function planFrom(raw: unknown): PlanEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PlanEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const content = pickString(e, 'content')
    if (!content) continue
    const status =
      e.status === 'completed' || e.status === 'in_progress' ? e.status : ('pending' as const)
    const priority = e.priority === 'high' || e.priority === 'low' ? e.priority : ('medium' as const)
    out.push({ content, status, priority })
  }
  return out
}

function kindFrom(update: AcpSessionUpdate, name: string | undefined): ToolKind | undefined {
  if (isToolKind(update.kind)) return update.kind
  return name ? toolKindFromName(name) : undefined
}

function statusFrom(update: AcpSessionUpdate, fallback?: ToolCallStatus) {
  return isToolCallStatus(update.status) ? update.status : fallback
}

/**
 * Map one `session/update` notification into zero or more turn events.
 *
 * Updates we deliberately drop: `available_commands_update`,
 * `current_mode_update`, `config_option_update`, `session_info_update` and
 * `usage_update` are session metadata, not transcript content.
 */
export function parseAcpSessionUpdate(update: AcpSessionUpdate): ParsedTurnEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = contentBlockText(update.content)
      return text ? [{ kind: 'assistant', payload: { text } }] : []
    }
    case 'agent_thought_chunk': {
      const text = contentBlockText(update.content)
      return text ? [{ kind: 'thought', payload: { text } }] : []
    }
    case 'user_message_chunk': {
      const text = contentBlockText(update.content)
      return text ? [{ kind: 'user', payload: { text } }] : []
    }
    case 'tool_call': {
      const name = pickString(update, 'toolName')
      const input = update.rawInput
      const role = toolCallRoleFields(name, input)
      const title =
        pickString(update, 'title') ??
        toolCallRoleTitle(role.callRole, name, input, {
          mcpServer: role.mcpServer,
          fallback: name ?? 'tool',
        })
      return [
        {
          kind: 'tool_start',
          payload: {
            toolCallId: pickString(update, 'toolCallId'),
            name: name ?? title,
            title,
            toolKind: kindFrom(update, name ?? title),
            callRole: role.callRole,
            ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
            status: statusFrom(update, 'pending'),
            input,
            locations: locationsFrom(update.locations),
            ...(update.content ? { content: toolContentText(update.content) } : {}),
          },
        },
      ]
    }
    case 'tool_call_update': {
      const status = statusFrom(update)
      // Progress pings (still pending/in_progress) only matter once the pill
      // exists, and `tool_call` already created it.
      if (status !== 'completed' && status !== 'failed') return []
      const name = pickString(update, 'toolName')
      const role = toolCallRoleFields(name, update.rawInput)
      return [
        {
          kind: 'tool_result',
          payload: {
            toolCallId: pickString(update, 'toolCallId'),
            name,
            title: pickString(update, 'title'),
            toolKind: kindFrom(update, name),
            callRole: role.callRole,
            ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
            status,
            content: toolContentText(update.content),
            rawOutput: update.rawOutput,
            locations: locationsFrom(update.locations),
          },
        },
      ]
    }
    case 'plan':
    case 'plan_update': {
      const plan = planFrom(update.entries)
      return plan.length > 0 ? [{ kind: 'plan', payload: { plan } }] : []
    }
    default:
      return []
  }
}
