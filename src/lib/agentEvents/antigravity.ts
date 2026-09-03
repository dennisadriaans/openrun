/**
 * Antigravity (`agy --output-format stream-json`) → ACP-shaped turn events.
 *
 * Despite mirroring Claude Code's *flags*, `agy` streams a schema of its own:
 * every line is `{ event: 'init' | 'step_update' | 'result' }`, and the payload
 * hangs off a key named after the event. There is no `type` field anywhere, so
 * Claude's adapter matches nothing and the whole turn parses as silence.
 *
 * Shape of a turn:
 *   {"event":"init","conversation_id":…,"init":{model,cwd,tools,permission_mode}}
 *   {"event":"step_update","step_update":{step_index,step_type,state,…}}
 *   {"event":"result","result":{status,response,usage,…}}
 *
 * `step_type` is `user_input` | `agent_response` | `tool`, and `state` is
 * `ACTIVE` | `DONE` | `ERROR`, which maps onto ACP's tool lifecycle directly.
 */
import { toolCallTitle, toolKindFromName, type ToolCallStatus } from '../acp.ts'
import { toolCallRoleFields, toolCallRoleTitle } from '../toolCallRole.ts'
import {
  locationsFromToolInput,
  pickString,
  toolInputSummary,
  type ParsedTurnEvent,
} from './types.ts'

/** `agy` step states → ACP tool status. */
function statusFor(state: string): ToolCallStatus {
  if (state === 'DONE') return 'completed'
  if (state === 'ERROR') return 'failed'
  return 'in_progress'
}

/**
 * Tool parameters arrive PascalCased (`Pattern`, `SearchDirectory`,
 * `CommandLine`), which the shared summary/location helpers — written against
 * Claude's snake_case — cannot read. Alias the keys we care about down to the
 * conventional spelling so titles and file locations render like every other
 * runtime, keeping the originals for the raw input view.
 */
const PARAM_ALIASES: Record<string, string> = {
  CommandLine: 'command',
  Command: 'command',
  AbsolutePath: 'file_path',
  TargetFile: 'file_path',
  FilePath: 'file_path',
  Path: 'path',
  SearchDirectory: 'path',
  Pattern: 'pattern',
  Query: 'query',
  Explanation: 'description',
}

function normalizeParams(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const obj = input as Record<string, unknown>
  const out: Record<string, unknown> = { ...obj }
  for (const [from, to] of Object.entries(PARAM_ALIASES)) {
    if (obj[from] !== undefined && out[to] === undefined) out[to] = obj[from]
  }
  return out
}

/**
 * A step index identifies a tool call across its ACTIVE → DONE/ERROR pair, so
 * it is the natural correlation id. Namespaced to stay distinct from any real
 * id another runtime might emit.
 */
function toolCallId(conversationId: string, stepIndex: number): string {
  return `agy-${conversationId || 'turn'}-${stepIndex}`
}

function errorMessage(toolInfo: Record<string, unknown>): string {
  const error = toolInfo.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const message = pickString(error as Record<string, unknown>, 'message', 'type')
    if (message) return message
  }
  return ''
}

function parseStepUpdate(step: Record<string, unknown>): ParsedTurnEvent[] {
  const stepType = String(step.step_type ?? '')
  const state = String(step.state ?? '')

  if (stepType === 'agent_response') {
    // Present only when the model actually emitted prose this step; a step that
    // exists purely to carry usage/timing has no text and must stay silent.
    const text = pickString(step, 'text_delta', 'text')
    if (!text) return []
    return [{ kind: 'assistant', payload: { text } }]
  }

  if (stepType === 'tool') {
    const toolInfo =
      step.tool_info && typeof step.tool_info === 'object'
        ? (step.tool_info as Record<string, unknown>)
        : {}
    const name = pickString(step, 'tool_name') ?? pickString(toolInfo, 'name') ?? 'tool'
    const rawInput = toolInfo.parameters
    const input = normalizeParams(rawInput)
    const stepIndex = typeof step.step_index === 'number' ? step.step_index : -1
    const id = toolCallId(String(step.conversation_id ?? ''), stepIndex)
    const role = toolCallRoleFields(name, input, {})
    const status = statusFor(state)

    if (state === 'ACTIVE') {
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

    const message = errorMessage(toolInfo)
    return [
      {
        kind: 'tool_result',
        payload: {
          toolCallId: id,
          name,
          status,
          ...(message ? { content: message } : {}),
        },
      },
    ]
  }

  // `user_input` is the prompt echoed back; chat already shows it.
  return []
}

/** One parsed `agy` stdout object → zero or more canonical events. */
export function parseAntigravityObject(obj: Record<string, unknown>): ParsedTurnEvent[] {
  const event = String(obj.event ?? '')

  if (event === 'step_update') {
    const step = obj.step_update
    if (!step || typeof step !== 'object') return []
    return parseStepUpdate(step as Record<string, unknown>)
  }

  if (event === 'result') {
    const result =
      obj.result && typeof obj.result === 'object' ? (obj.result as Record<string, unknown>) : {}
    const status = String(result.status ?? '')
    const response = pickString(result, 'response') ?? ''

    if (status && status !== 'SUCCESS') {
      const message = pickString(result, 'error', 'message') || response || `agy run ${status}`
      return [
        { kind: 'error', payload: { text: message } },
        { kind: 'turn_done', payload: {} },
      ]
    }

    // `response` repeats the whole answer the `agent_response` steps already
    // streamed, so carrying it here too would render the reply twice. It is the
    // fallback only when the turn produced no prose steps at all.
    return [{ kind: 'turn_done', payload: { stopReason: 'end_turn' } }]
  }

  // `init` carries the model and tool roster, not turn content.
  return []
}

/**
 * Readable answer from a whole `agy` stdout capture.
 *
 * Returns null when this does not look like `agy` output, so the shared
 * `parseAssistantText` fallback chain can keep trying other shapes.
 */
export function extractAntigravityAssistantText(stdout: string): string | null {
  const texts: string[] = []
  let final = ''
  let sawEnvelope = false

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const event = String(obj.event ?? '')
    if (event !== 'init' && event !== 'step_update' && event !== 'result') continue
    sawEnvelope = true

    if (event === 'step_update') {
      const step = obj.step_update as Record<string, unknown> | undefined
      if (!step || String(step.step_type ?? '') !== 'agent_response') continue
      const text = pickString(step, 'text_delta', 'text')
      if (text) texts.push(text)
    }

    if (event === 'result') {
      const result = obj.result as Record<string, unknown> | undefined
      if (result) final = pickString(result, 'response') ?? ''
    }
  }

  if (!sawEnvelope) return null

  const joined = texts.join('').trim()
  if (joined) return joined
  return final.trim()
}
