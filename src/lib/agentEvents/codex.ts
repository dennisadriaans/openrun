/**
 * Codex `exec --json` → ACP-shaped turn events.
 *
 * Codex reports a stream of `item.started` / `item.updated` / `item.completed`
 * envelopes wrapping a typed item (`agent_message`, `command_execution`,
 * `file_change`, `mcp_tool_call`, `reasoning`, `todo_list`, `web_search`,
 * `error`), then `turn.completed` / `turn.failed`.
 *
 * The item types map onto ACP tool kinds directly, and `item.started` →
 * `in_progress` / `item.completed` → `completed|failed` is exactly ACP's tool
 * lifecycle, so this adapter is mostly a rename.
 */
import { toolCallTitle, toolKindFromName, type ToolCallStatus, type ToolKind } from '../acp.ts'
import type { PlanEntry, PlanEntryStatus } from '../acp.ts'
import { toolCallRoleFields, toolCallRoleTitle } from '../toolCallRole.ts'
import {
  locationsFromToolInput,
  pickNumber,
  pickString,
  recordAt,
  toolInputSummary,
  toolResultContent,
  type ParsedTurnEvent,
} from './types.ts'
import type { TurnUsage } from '../turnUsage.ts'

/**
 * Codex token counts → a context snapshot.
 *
 * Codex is the only CLI here that states its own window
 * (`info.model_context_window`), and it separates the *last* request from the
 * turn total — `last_token_usage` is the one that describes what the model is
 * carrying right now.
 */
function codexUsage(counts: Record<string, unknown> | undefined): Partial<TurnUsage> | undefined {
  if (!counts) return undefined
  const input = pickNumber(counts, 'input_tokens', 'inputTokens') ?? 0
  const output = pickNumber(counts, 'output_tokens', 'outputTokens') ?? 0
  const cacheRead = pickNumber(counts, 'cached_input_tokens', 'cachedInputTokens') ?? 0
  const total = pickNumber(counts, 'total_tokens', 'totalTokens')
  if (input + output + cacheRead <= 0 && !total) return undefined
  // `input_tokens` already includes the cached part, so the sum in
  // `mergeTurnUsage` would double-count it. State the context directly.
  return {
    input: Math.max(0, input - cacheRead),
    output,
    cacheRead,
    cacheWrite: 0,
    contextTokens: total ?? input + output,
  }
}

/** Reasoning body: a string, or Codex/Responses `summary: [{ text }]`. */
function reasoningText(item: Record<string, unknown>): string {
  const direct = pickString(item, 'text', 'content')
  if (direct) return direct
  if (typeof item.summary === 'string' && item.summary) return item.summary
  if (!Array.isArray(item.summary)) return ''
  const parts: string[] = []
  for (const entry of item.summary) {
    if (!entry || typeof entry !== 'object') continue
    const text = pickString(entry as Record<string, unknown>, 'text', 'content')
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

/** Codex item status → ACP tool status. */
function statusFor(item: Record<string, unknown>, envelope: string): ToolCallStatus {
  const raw = typeof item.status === 'string' ? item.status : ''
  if (raw === 'failed') return 'failed'
  if (raw === 'completed') return 'completed'
  if (raw === 'in_progress') return 'in_progress'
  return envelope === 'item.completed' ? 'completed' : 'in_progress'
}

function planFromTodoList(item: Record<string, unknown>): PlanEntry[] {
  const items = Array.isArray(item.items) ? item.items : []
  const entries: PlanEntry[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const todo = raw as Record<string, unknown>
    const content = pickString(todo, 'text', 'content', 'title')
    if (!content) continue
    const done = todo.completed === true || todo.status === 'completed'
    const running = todo.status === 'in_progress'
    const status: PlanEntryStatus = done ? 'completed' : running ? 'in_progress' : 'pending'
    entries.push({ content, priority: 'medium', status })
  }
  return entries
}

/** Changed-file list from a `file_change` item, as ACP locations. */
function locationsFromFileChange(item: Record<string, unknown>) {
  const changes = Array.isArray(item.changes) ? item.changes : []
  const locations = changes
    .map((c) =>
      c && typeof c === 'object' ? pickString(c as Record<string, unknown>, 'path') : undefined,
    )
    .filter((p): p is string => Boolean(p))
    .map((path) => ({ path }))
  return locations.length > 0 ? locations : undefined
}

export function parseCodexObject(obj: Record<string, unknown>): ParsedTurnEvent[] {
  const type = String(obj.type ?? '')

  if (type === 'token_count') {
    const info = recordAt(obj, 'info') ?? obj
    const usage = codexUsage(
      recordAt(info, 'last_token_usage') ?? recordAt(info, 'total_token_usage'),
    )
    if (!usage) return []
    const window = pickNumber(info, 'model_context_window', 'modelContextWindow')
    const model = pickString(info, 'model', 'model_slug')
    return [
      {
        kind: 'usage',
        payload: {
          usage: { ...usage, ...(window ? { contextLimit: window } : {}), ...(model ? { model } : {}) },
        },
      },
    ]
  }

  if (type === 'item.started' || type === 'item.updated' || type === 'item.completed') {
    const item = obj.item as Record<string, unknown> | undefined
    if (!item) return []
    const itemType = String(item.type ?? item.item_type ?? '')
    const id = typeof item.id === 'string' ? item.id : undefined
    const status = statusFor(item, type)

    if (itemType === 'agent_message' || itemType === 'assistant_message') {
      if (type !== 'item.completed') return []
      const text = typeof item.text === 'string' ? item.text : ''
      return text ? [{ kind: 'assistant', payload: { text } }] : []
    }

    if (itemType === 'reasoning') {
      const text = reasoningText(item)
      if (type === 'item.started') {
        return [{ kind: 'thought', payload: { text } }]
      }
      if (type === 'item.updated' || type === 'item.completed') {
        return text ? [{ kind: 'thought', payload: { text } }] : []
      }
      return []
    }

    if (itemType === 'todo_list') {
      const plan = planFromTodoList(item)
      return plan.length > 0 ? [{ kind: 'plan', payload: { plan } }] : []
    }

    if (itemType === 'command_execution') {
      const command = pickString(item, 'command') ?? ''
      if (type === 'item.started') {
        return [
          {
            kind: 'tool_start',
            payload: {
              toolCallId: id,
              name: 'command_execution',
              title: toolCallTitle('command_execution', command),
              toolKind: 'execute',
              status,
              input: { command: item.command },
            },
          },
        ]
      }
      if (type === 'item.completed') {
        const content = pickString(item, 'aggregated_output', 'output', 'text') ?? ''
        const exitCode = typeof item.exit_code === 'number' ? item.exit_code : null
        return [
          {
            kind: 'tool_result',
            payload: {
              toolCallId: id,
              name: 'command_execution',
              toolKind: 'execute',
              // A non-zero exit is a failed call even when Codex omits status.
              status: exitCode !== null && exitCode !== 0 ? 'failed' : status,
              content,
              rawOutput: exitCode === null ? undefined : { exitCode },
            },
          },
        ]
      }
      return []
    }

    if (itemType === 'file_change' || itemType === 'patch_apply') {
      const locations = locationsFromFileChange(item)
      const title = locations
        ? toolCallTitle('file_change', locations.map((l) => l.path).join(', '))
        : 'file_change'
      const kind: ToolKind = 'edit'
      if (type === 'item.started') {
        return [
          {
            kind: 'tool_start',
            payload: {
              toolCallId: id,
              name: 'file_change',
              title,
              toolKind: kind,
              status,
              locations,
            },
          },
        ]
      }
      if (type === 'item.completed') {
        return [
          {
            kind: 'tool_result',
            payload: {
              toolCallId: id,
              name: 'file_change',
              toolKind: kind,
              status,
              locations,
              content: toolResultContent(item.changes),
            },
          },
        ]
      }
      return []
    }

    if (itemType === 'web_search') {
      const query = pickString(item, 'query') ?? ''
      if (type === 'item.started') {
        return [
          {
            kind: 'tool_start',
            payload: {
              toolCallId: id,
              name: 'web_search',
              title: toolCallTitle('web_search', query),
              toolKind: 'fetch',
              status,
              input: { query },
            },
          },
        ]
      }
      if (type === 'item.completed') {
        return [
          {
            kind: 'tool_result',
            payload: {
              toolCallId: id,
              name: 'web_search',
              toolKind: 'fetch',
              status,
              content: toolResultContent(item.results ?? item.output),
            },
          },
        ]
      }
      return []
    }

    if (itemType === 'mcp_tool_call') {
      const name = pickString(item, 'tool', 'name') ?? 'mcp_tool'
      const input = item.arguments ?? item.input
      const mcpServer = pickString(item, 'server', 'serverName', 'mcpServer')
      const role = toolCallRoleFields(name, input, {
        itemType: 'mcp_tool_call',
        ...(mcpServer ? { mcpServer } : {}),
      })
      if (type === 'item.started') {
        return [
          {
            kind: 'tool_start',
            payload: {
              toolCallId: id,
              name,
              title: toolCallRoleTitle(role.callRole, name, input, {
                mcpServer: role.mcpServer,
                fallback: toolCallTitle(name, toolInputSummary(name, input)),
              }),
              toolKind: toolKindFromName(name),
              callRole: role.callRole,
              ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
              status,
              input,
              locations: locationsFromToolInput(input),
            },
          },
        ]
      }
      if (type === 'item.completed') {
        return [
          {
            kind: 'tool_result',
            payload: {
              toolCallId: id,
              name,
              toolKind: toolKindFromName(name),
              callRole: role.callRole,
              ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
              status,
              content: toolResultContent(item.result ?? item.output ?? item.content),
            },
          },
        ]
      }
      return []
    }

    if (itemType === 'error' && type === 'item.completed') {
      return [
        {
          kind: 'error',
          payload: {
            message: pickString(item, 'message', 'text') ?? 'Codex item error',
          },
        },
      ]
    }

    return []
  }

  if (type === 'turn.completed') {
    const usage = codexUsage(recordAt(obj, 'usage'))
    return [
      ...(usage ? [{ kind: 'usage' as const, payload: { usage } }] : []),
      { kind: 'turn_done' as const, payload: { stopReason: 'end_turn' as const } },
    ]
  }

  if (type === 'turn.failed' || type === 'error') {
    const errorObj = obj.error as { message?: string } | undefined
    const message =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error === 'string' && obj.error) ||
      (typeof errorObj?.message === 'string' ? errorObj.message : '') ||
      'Codex turn failed'
    // No stopReason: ACP's values describe how a turn *ended normally*, and a
    // failed turn is not one of them. The error event carries the reason.
    return [
      { kind: 'error', payload: { message } },
      { kind: 'turn_done', payload: {} },
    ]
  }

  return []
}
