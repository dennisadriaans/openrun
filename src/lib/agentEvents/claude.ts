/**
 * Claude Code `--output-format stream-json` → ACP-shaped turn events.
 *
 * Claude speaks Anthropic Messages envelopes: `type: "assistant"` with content
 * blocks, `type: "user"` carrying `tool_result` blocks, a final `type:
 * "result"`, and — under `--permission-prompt-tool stdio` — `control_request`
 * lines asking for tool approval (see `lib/claudeControl.ts`).
 *
 * Claude sends no tool `kind`, `status` or `locations`, so we infer them:
 * a `tool_use` block starts an `in_progress` call and the matching
 * `tool_result` settles it.
 */
import { resolveToolKind, toolCallTitle } from '../acp.ts'
import { parseControlRequest } from '../claudeControl.ts'
import { permissionOptionsForTool } from '../approvals.ts'
import { toolCallRoleFields, toolCallRoleTitle } from '../toolCallRole.ts'
import {
  AssistantDeltaCoalescer,
  locationsFromToolInput,
  pickNumber,
  recordAt,
  textFromContentBlocks,
  toolInputSummary,
  toolResultContent,
  type ParsedTurnEvent,
} from './types.ts'
import type { TurnUsage } from '../turnUsage.ts'

/**
 * Anthropic `usage` block → a context snapshot.
 *
 * Every `assistant` message carries one, and it describes *that request*: the
 * fresh input, what the cache served, and what was written into it. Summed,
 * that is what the model was holding — Claude never states a window, so
 * `contextLimit` is left for the model table to fill in.
 */
function claudeUsage(
  message: Record<string, unknown> | undefined,
): Partial<TurnUsage> | undefined {
  const usage = recordAt(message, 'usage')
  if (!usage) return undefined
  const input = pickNumber(usage, 'input_tokens') ?? 0
  const output = pickNumber(usage, 'output_tokens') ?? 0
  const cacheRead = pickNumber(usage, 'cache_read_input_tokens') ?? 0
  const creation = recordAt(usage, 'cache_creation')
  const cacheWrite =
    pickNumber(usage, 'cache_creation_input_tokens') ??
    (pickNumber(creation, 'ephemeral_5m_input_tokens') ?? 0) +
      (pickNumber(creation, 'ephemeral_1h_input_tokens') ?? 0)
  if (input + output + cacheRead + cacheWrite <= 0) return undefined
  const model = typeof message?.model === 'string' ? message.model : ''
  return { input, output, cacheRead, cacheWrite, model }
}

function claudeUsageEvent(
  message: Record<string, unknown> | undefined,
): ParsedTurnEvent[] {
  const usage = claudeUsage(message)
  return usage ? [{ kind: 'usage', payload: { usage } }] : []
}

export function parseClaudeObject(obj: Record<string, unknown>): ParsedTurnEvent[] {
  const type = String(obj.type ?? '')

  // Supervised mode: a `can_use_tool` control request means Claude is waiting
  // for an allow/deny decision on stdin. Surface it as a structured event so
  // chat + SSE can prompt without scraping stdout.
  if (type === 'control_request') {
    const approval = parseControlRequest(obj)
    if (!approval) return []
    const role = toolCallRoleFields(approval.toolName, approval.input)
    return [
      {
        kind: 'approval_request',
        payload: {
          requestId: approval.requestId,
          name: approval.toolName,
          title: toolCallRoleTitle(role.callRole, approval.toolName, approval.input, {
            mcpServer: role.mcpServer,
            fallback: toolCallTitle(
              approval.toolName,
              toolInputSummary(approval.toolName, approval.input),
            ),
          }),
          toolKind: resolveToolKind(approval.toolName, undefined, approval.input),
          callRole: role.callRole,
          ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
          input: approval.input,
          locations: locationsFromToolInput(approval.input),
          options: permissionOptionsForTool(approval.toolName),
        },
      },
    ]
  }

  if (type === 'assistant') {
    const message = obj.message as Record<string, unknown> | undefined
    const content = message?.content
    const out: ParsedTurnEvent[] = []
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
          out.push({ kind: 'assistant', payload: { text: b.text } })
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking) {
          out.push({ kind: 'thought', payload: { text: b.thinking } })
        } else if (b.type === 'redacted_thinking') {
          const text = typeof b.thinking === 'string' ? b.thinking : ''
          out.push({ kind: 'thought', payload: { text } })
        } else if (b.type === 'tool_use') {
          const name = typeof b.name === 'string' ? b.name : 'tool'
          const role = toolCallRoleFields(name, b.input)
          out.push({
            kind: 'tool_start',
            payload: {
              toolCallId: typeof b.id === 'string' ? b.id : undefined,
              name,
              title: toolCallRoleTitle(role.callRole, name, b.input, {
                mcpServer: role.mcpServer,
                fallback: toolCallTitle(name, toolInputSummary(name, b.input)),
              }),
              toolKind: resolveToolKind(name, undefined, b.input),
              callRole: role.callRole,
              ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
              status: 'in_progress',
              input: b.input,
              locations: locationsFromToolInput(b.input),
            },
          })
        }
      }
    } else {
      const text = textFromContentBlocks(content)
      if (text) out.push({ kind: 'assistant', payload: { text } })
    }
    out.push(...claudeUsageEvent(message))
    return out
  }

  if (type === 'user') {
    const message = obj.message as Record<string, unknown> | undefined
    const content = message?.content
    const out: ParsedTurnEvent[] = []
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'tool_result') {
          out.push({
            kind: 'tool_result',
            payload: {
              toolCallId: typeof b.tool_use_id === 'string' ? b.tool_use_id : undefined,
              // Claude marks a failed tool with is_error on the result block.
              status: b.is_error === true ? 'failed' : 'completed',
              content: toolResultContent(b.content),
            },
          })
        }
      }
    }
    return out
  }

  if (type === 'result') {
    const out: ParsedTurnEvent[] = []
    const errored = obj.is_error === true || obj.subtype === 'error'
    if (errored) {
      out.push({
        kind: 'error',
        payload: {
          message:
            (typeof obj.error === 'string' && obj.error) ||
            (typeof obj.result === 'string' && obj.result) ||
            'Claude reported an error result',
        },
      })
    }
    // Do not emit `assistant` here — Claude already streamed type=assistant
    // text blocks; `result` repeats that final text. Keep it on turn_done so
    // chat can fall back when a turn had no assistant events.
    // A stop reason describes how a turn ended *normally*, so a failed result
    // gets none — the error event above already says what happened.
    const stopReason =
      obj.subtype === 'error_max_turns'
        ? ('max_turn_requests' as const)
        : errored
          ? undefined
          : ('end_turn' as const)
    // No usage here: `result.usage` sums every request in the turn, which is
    // spend, not context. The per-message snapshots above are the gauge.
    out.push({
      kind: 'turn_done',
      payload: {
        result: typeof obj.result === 'string' ? obj.result : undefined,
        ...(stopReason ? { stopReason } : {}),
      },
    })
    return out
  }

  if (type === 'error') {
    return [
      {
        kind: 'error',
        payload: {
          message:
            (typeof obj.message === 'string' && obj.message) ||
            (typeof obj.error === 'string' && obj.error) ||
            JSON.stringify(obj),
        },
      },
    ]
  }

  if (type === 'stream_event') {
    const event = obj.event
    if (event && typeof event === 'object') {
      return parseClaudeStreamEvent(event as Record<string, unknown>)
    }
    return parseClaudeStreamEvent(obj)
  }

  if (type === 'content_block_start' || type === 'content_block_delta') {
    return parseClaudeStreamEvent(obj)
  }

  return []
}

/** Anthropic API stream events wrapped by `--include-partial-messages`. */
export function parseClaudeStreamEvent(event: Record<string, unknown>): ParsedTurnEvent[] {
  const type = String(event.type ?? '')

  if (type === 'content_block_start') {
    const block = event.content_block
    if (!block || typeof block !== 'object') return []
    const b = block as Record<string, unknown>
    const blockType = String(b.type ?? '')
    if (blockType === 'thinking' || blockType === 'redacted_thinking') {
      const text = typeof b.thinking === 'string' ? b.thinking : ''
      return [{ kind: 'thought', payload: { text } }]
    }
    if (blockType === 'text' && typeof b.text === 'string' && b.text) {
      return [{ kind: 'assistant', payload: { text: b.text } }]
    }
    return []
  }

  if (type === 'content_block_delta') {
    const delta = event.delta
    if (!delta || typeof delta !== 'object') return []
    const d = delta as Record<string, unknown>
    const deltaType = String(d.type ?? '')
    if (deltaType === 'thinking_delta') {
      const text =
        (typeof d.thinking === 'string' && d.thinking) ||
        (typeof d.text === 'string' && d.text) ||
        ''
      return text ? [{ kind: 'thought', payload: { text } }] : []
    }
    if (deltaType === 'text_delta') {
      const text = typeof d.text === 'string' ? d.text : ''
      return text ? [{ kind: 'assistant', payload: { text } }] : []
    }
    return []
  }

  return []
}

/**
 * Stateful ingest for Claude JSONL: token-sized `stream_event` deltas go
 * through the prose coalescer; a later complete `assistant` message must not
 * replay the same thinking/text once partials have already landed.
 */
export class ClaudeStdoutIngest {
  private coalescer = new AssistantDeltaCoalescer()
  private sawPartialProse = false

  pushLine(line: string): ParsedTurnEvent[] {
    const trimmed = line.trim()
    if (!trimmed) return []
    if (!trimmed.startsWith('{')) {
      return this.emitComplete([{ kind: 'raw', payload: { text: trimmed } }])
    }
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return this.emitComplete([{ kind: 'raw', payload: { text: trimmed } }])
    }
    const events = parseClaudeObject(obj)
    if (String(obj.type ?? '') === 'stream_event') {
      if (events.some((ev) => ev.kind === 'thought' || ev.kind === 'assistant')) {
        this.sawPartialProse = true
      }
      return this.coalescer.push(events)
    }
    return this.emitComplete(events)
  }

  flush(): ParsedTurnEvent[] {
    return this.coalescer.flush()
  }

  private emitComplete(events: ParsedTurnEvent[]): ParsedTurnEvent[] {
    const flushed = this.coalescer.flush()
    const rest = this.sawPartialProse
      ? events.filter((ev) => ev.kind !== 'thought' && ev.kind !== 'assistant')
      : events
    return [...flushed, ...rest]
  }
}
