/**
 * Read-only projection of a run's transcript as an **AI SDK UI Message Stream**.
 *
 * Why this exists: our own SSE (`lib/runLive.ts`) carries far more than a chat
 * — logs, check results, verdicts, repair attempts — and the app's own client
 * already consumes it. But "a chat transcript over SSE" has a de-facto standard
 * shape, the one Vercel's `ai` package emits and `useChat` consumes, and other
 * tools speak it. So the transcript is *also* offered in that format, for
 * anything outside this app that wants to read a run.
 *
 * This is a projection, not a second source of truth: it maps the ACP-shaped
 * events we already store. Nothing writes through it, and the app's own UI does
 * not use it.
 *
 * The chunk shapes are declared here rather than imported so `lib/` stays
 * dependency-free and the client bundle never grows an SDK it does not use.
 * They match the `UIMessageChunk` union in `ai@7`; the tool-approval chunks are
 * the ones that make our Supervised prompts representable.
 */
import type { TurnEventPayload, TurnEventRow } from './turnEvents.ts'

/** Headers a consumer needs to recognise the stream (`ai` sets these too). */
export const UI_MESSAGE_STREAM_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'X-Accel-Buffering': 'no',
} as const

export type UiMessageChunk =
  | { type: 'start'; messageId?: string }
  | { type: 'start-step' }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | {
      type: 'tool-input-available'
      toolCallId: string
      toolName: string
      input: unknown
      title?: string
      dynamic?: true
    }
  | { type: 'tool-output-available'; toolCallId: string; output: unknown; dynamic?: true }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string; dynamic?: true }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string }
  | { type: 'tool-approval-response'; approvalId: string; approved: boolean; reason?: string }
  | { type: 'data-plan'; data: { entries: unknown[] } }
  | { type: 'data-raw'; data: { text: string }; transient?: true }
  | { type: 'error'; errorText: string }
  | { type: 'finish-step' }
  | { type: 'finish' }

function payloadOf(row: TurnEventRow): TurnEventPayload {
  try {
    return JSON.parse(row.payload) as TurnEventPayload
  } catch {
    return {}
  }
}

/**
 * Map one stored turn event to zero or more UI message chunks.
 *
 * Text and reasoning are emitted as a start/delta/end triple per event: our
 * events are already coalesced into whole paragraphs, so there is nothing to be
 * gained by pretending to stream them token by token.
 */
export function turnEventToUiChunks(row: TurnEventRow): UiMessageChunk[] {
  const payload = payloadOf(row)

  switch (row.kind) {
    case 'assistant': {
      if (!payload.text) return []
      return [
        { type: 'text-start', id: row.id },
        { type: 'text-delta', id: row.id, delta: payload.text },
        { type: 'text-end', id: row.id },
      ]
    }
    case 'thought': {
      if (!payload.text) return []
      return [
        { type: 'reasoning-start', id: row.id },
        { type: 'reasoning-delta', id: row.id, delta: payload.text },
        { type: 'reasoning-end', id: row.id },
      ]
    }
    case 'tool_start': {
      return [
        {
          type: 'tool-input-available',
          toolCallId: payload.toolCallId ?? row.id,
          toolName: payload.name ?? 'tool',
          input: payload.input ?? {},
          ...(payload.title ? { title: payload.title } : {}),
          // Our tools are the agent's, not ones we declared to a model, which
          // is exactly what the SDK means by a dynamic tool.
          dynamic: true,
        },
      ]
    }
    case 'tool_result': {
      const toolCallId = payload.toolCallId ?? row.id
      if (payload.status === 'failed') {
        return [
          {
            type: 'tool-output-error',
            toolCallId,
            errorText: payload.content || 'Tool call failed',
            dynamic: true,
          },
        ]
      }
      return [
        {
          type: 'tool-output-available',
          toolCallId,
          output: payload.rawOutput ?? payload.content ?? '',
          dynamic: true,
        },
      ]
    }
    case 'approval_request': {
      if (!payload.requestId) return []
      return [
        {
          type: 'tool-approval-request',
          approvalId: payload.requestId,
          toolCallId: payload.toolCallId ?? payload.requestId,
        },
      ]
    }
    case 'approval_resolved': {
      if (!payload.requestId) return []
      return [
        {
          type: 'tool-approval-response',
          approvalId: payload.requestId,
          approved: payload.decision === 'allow',
          ...(payload.reason ? { reason: payload.reason } : {}),
        },
      ]
    }
    case 'plan': {
      if (!payload.plan || payload.plan.length === 0) return []
      return [{ type: 'data-plan', data: { entries: payload.plan } }]
    }
    case 'error': {
      return [{ type: 'error', errorText: payload.message || 'Error' }]
    }
    case 'raw': {
      if (!payload.text) return []
      // Transient: unparsed CLI noise is worth showing live but not worth
      // keeping in a consumer's message history.
      return [{ type: 'data-raw', data: { text: payload.text }, transient: true }]
    }
    case 'turn_done':
    case 'user':
      return []
    default:
      return []
  }
}

/**
 * Project a whole run: one UI message per assistant turn, wrapped in the
 * start/finish chunks a consumer expects.
 */
export function runToUiChunks(
  messages: Array<{ id: string; role: string; events: TurnEventRow[] }>,
): UiMessageChunk[] {
  const chunks: UiMessageChunk[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    chunks.push({ type: 'start', messageId: message.id })
    chunks.push({ type: 'start-step' })
    for (const event of message.events) chunks.push(...turnEventToUiChunks(event))
    chunks.push({ type: 'finish-step' })
    chunks.push({ type: 'finish' })
  }
  return chunks
}

/** One SSE frame, terminated. `[DONE]` closes the stream. */
export function encodeUiSseFrame(chunk: UiMessageChunk | '[DONE]'): string {
  const body = chunk === '[DONE]' ? '[DONE]' : JSON.stringify(chunk)
  return `data: ${body}\n\n`
}
