/**
 * Grok `--output-format streaming-json` (xAI-native NDJSON) → turn events.
 *
 * Lines look like `{ "type": "text", "data": "Hello" }` / `thought` /
 * `tool_call` / `tool_call_update` / `end`. Those are not Anthropic Messages
 * envelopes — and the field names inside them (`toolCallId`, `rawInput`,
 * `rawOutput`, `title`, `status: "completed"`) are ACP's, which is why this
 * adapter is the thinnest of the three: Grok is already most of the way to the
 * canonical model.
 */
import { isToolCallStatus, isToolKind, resolveToolKind, toolCallTitle } from '../acp.ts'
import type { PlanEntry, ToolCallLocation, ToolCallStatus } from '../acp.ts'
import { toolCallRoleFields, toolCallRoleTitle } from '../toolCallRole.ts'
import { pickString, toolInputSummary, toolResultContent, type ParsedTurnEvent } from './types.ts'

/** Unwrap nested Grok tool output (e.g. ListDir Content.content). */
export function grokToolOutput(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const nested = o.Content ?? o.content
    if (typeof nested === 'string') return nested
    if (nested && typeof nested === 'object') {
      const inner = (nested as Record<string, unknown>).content
      if (typeof inner === 'string') return inner
    }
  }
  return toolResultContent(raw)
}

function locationsFrom(obj: Record<string, unknown>): ToolCallLocation[] | undefined {
  const raw = obj.locations
  if (!Array.isArray(raw)) return undefined
  const out: ToolCallLocation[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const path = pickString(entry as Record<string, unknown>, 'path')
    if (!path) continue
    const line = (entry as Record<string, unknown>).line
    out.push(typeof line === 'number' ? { path, line } : { path })
  }
  return out.length > 0 ? out : undefined
}

/** Grok status strings are ACP's, plus a couple of synonyms older builds send. */
function statusFrom(obj: Record<string, unknown>, fallback: ToolCallStatus): ToolCallStatus {
  const raw = typeof obj.status === 'string' ? obj.status.toLowerCase() : ''
  if (isToolCallStatus(raw)) return raw
  if (raw === 'success' || raw === 'done') return 'completed'
  if (raw === 'error') return 'failed'
  if (raw === 'running') return 'in_progress'
  return fallback
}

/**
 * Map one parsed Grok streaming-json object into canonical turn events.
 * Noise (`available_commands`, `usage`, …) returns [].
 */
export function parseGrokObject(obj: Record<string, unknown>): ParsedTurnEvent[] {
  const type = String(obj.type ?? obj.event ?? '')

  if (type === 'text') {
    const data = pickString(obj, 'data', 'text') ?? ''
    return data ? [{ kind: 'assistant', payload: { text: data } }] : []
  }

  // Reasoning used to be dropped on the floor; it is a first-class ACP update
  // (`agent_thought_chunk`) and chat renders it collapsed.
  if (type === 'thought' || type === 'reasoning' || type === 'thinking') {
    const data = pickString(obj, 'data', 'text') ?? ''
    return data ? [{ kind: 'thought', payload: { text: data } }] : []
  }

  if (type === 'tool_call') {
    const toolCallId = pickString(obj, 'toolCallId', 'id')
    const name = pickString(obj, 'toolName', 'title', 'name') ?? 'tool'
    const input = obj.rawInput ?? obj.input ?? obj.arguments
    const kindRaw = obj.kind
    const role = toolCallRoleFields(name, input)
    return [
      {
        kind: 'tool_start',
        payload: {
          toolCallId,
          name,
          title:
            pickString(obj, 'title') ??
            toolCallRoleTitle(role.callRole, name, input, {
              mcpServer: role.mcpServer,
              fallback: toolCallTitle(name, toolInputSummary(name, input)),
            }),
          toolKind: resolveToolKind(
            name,
            isToolKind(kindRaw) ? kindRaw : undefined,
            input,
            pickString(obj, 'title'),
          ),
          callRole: role.callRole,
          ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
          status: statusFrom(obj, 'in_progress'),
          input,
          locations: locationsFrom(obj),
        },
      },
    ]
  }

  if (type === 'tool_call_update') {
    const status = statusFrom(obj, 'in_progress')
    // An in-flight progress ping carries no result yet; the pill already shows
    // the call as running, so there is nothing to append to the transcript.
    if (status !== 'completed' && status !== 'failed') return []
    const toolCallId = pickString(obj, 'toolCallId', 'id')
    const name = pickString(obj, 'toolName', 'title', 'name')
    const raw = obj.rawOutput ?? obj.output ?? obj.content
    const kindRaw = obj.kind
    const toolInput = obj.rawInput ?? obj.input ?? obj.arguments
    const role = toolCallRoleFields(name, toolInput)
    return [
      {
        kind: 'tool_result',
        payload: {
          toolCallId,
          name,
          title: pickString(obj, 'title'),
          toolKind: resolveToolKind(
            name,
            isToolKind(kindRaw) ? kindRaw : undefined,
            toolInput,
            pickString(obj, 'title'),
          ),
          callRole: role.callRole,
          ...(role.mcpServer ? { mcpServer: role.mcpServer } : {}),
          status,
          content: grokToolOutput(raw),
          locations: locationsFrom(obj),
        },
      },
    ]
  }

  if (type === 'plan') {
    const entries = Array.isArray(obj.entries) ? obj.entries : []
    const plan = entries
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const e = entry as Record<string, unknown>
        const content = pickString(e, 'content', 'text')
        if (!content) return null
        const status =
          e.status === 'completed' || e.status === 'in_progress' ? e.status : ('pending' as const)
        const priority =
          e.priority === 'high' || e.priority === 'low' ? e.priority : ('medium' as const)
        return { content, status, priority } satisfies PlanEntry
      })
      .filter((e): e is PlanEntry => e !== null)
    return plan.length > 0 ? [{ kind: 'plan', payload: { plan } }] : []
  }

  if (type === 'error') {
    const message = pickString(obj, 'message', 'data', 'error') ?? 'Grok reported an error'
    return [{ kind: 'error', payload: { message } }]
  }

  if (type === 'end' || type === 'result' || type === 'done' || type === 'turn_done') {
    const result = pickString(obj, 'result', 'data', 'text') ?? ''
    return [{ kind: 'turn_done', payload: { result, stopReason: 'end_turn' } }]
  }

  // Legacy / alternate shapes some builds still emit.
  if (typeof obj.text === 'string' && obj.text.length > 0) {
    if (
      type === 'assistant' ||
      type === 'message' ||
      type === 'content' ||
      type === 'response' ||
      !type
    ) {
      return [{ kind: 'assistant', payload: { text: obj.text } }]
    }
  }
  if (typeof obj.content === 'string' && obj.content.length > 0) {
    if (type === 'assistant' || type === 'message' || type === 'response') {
      return [{ kind: 'assistant', payload: { text: obj.content } }]
    }
  }
  const message = obj.message as Record<string, unknown> | undefined
  if (message && typeof message.content === 'string' && message.content.length > 0) {
    return [{ kind: 'assistant', payload: { text: message.content } }]
  }

  return []
}

/**
 * Map one Grok stdout line (streaming-json NDJSON *or* plain/pretty text)
 * into canonical turn events. Non-envelope lines become assistant prose so
 * chat never gets one `raw` pill per JSON bracket.
 */
export function parseGrokStdoutLine(line: string): ParsedTurnEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  if (!trimmed.startsWith('{')) {
    return [{ kind: 'assistant', payload: { text: `${trimmed}\n` } }]
  }

  try {
    return parseGrokObject(JSON.parse(trimmed) as Record<string, unknown>)
  } catch {
    return [{ kind: 'assistant', payload: { text: `${trimmed}\n` } }]
  }
}

/**
 * Concatenate Grok `text`/`data` deltas from a JSONL stdout dump.
 * Returns null when the stream is not Grok-shaped JSONL (caller should fall
 * through to other unwrap paths). Returns '' when it is Grok JSONL but only
 * noise (thought/usage) was present.
 */
export function extractGrokAssistantText(stdout: string): string | null {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith('{')) return null

  let sawGrok = false
  let delta = ''
  const parts: string[] = []

  const flush = () => {
    if (!delta) return
    parts.push(delta)
    delta = ''
  }

  for (const line of trimmed.split('\n')) {
    const l = line.trim()
    if (!l.startsWith('{')) continue
    try {
      const obj = JSON.parse(l) as Record<string, unknown>
      const type = String(obj.type ?? '')
      if (
        type === 'text' ||
        type === 'thought' ||
        type === 'reasoning' ||
        type === 'thinking' ||
        type === 'tool_call' ||
        type === 'tool_call_update' ||
        type === 'available_commands' ||
        type === 'usage' ||
        type === 'end' ||
        type === 'plan'
      ) {
        sawGrok = true
      }
      if (type === 'text' && typeof obj.data === 'string') {
        delta += obj.data
        continue
      }
      flush()
    } catch {
      // Not JSON — ignore.
    }
  }
  flush()

  if (!sawGrok) return null
  return parts.join('\n\n').trim()
}
