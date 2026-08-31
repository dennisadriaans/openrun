/**
 * Shared turn-event shapes used by server parsers and the chat UI.
 * Kept outside `server/` so client components can import types without
 * pulling Node-only modules into the bundle.
 *
 * The vocabulary is ACP's (see `lib/acp.ts`), persisted under the kind names
 * this table has always used so old rows keep rendering:
 *
 *   ACP session/update           →  TurnEventKind
 *   user_message_chunk           →  user
 *   agent_message_chunk          →  assistant
 *   agent_thought_chunk          →  thought
 *   tool_call                    →  tool_start
 *   tool_call_update             →  tool_result
 *   plan / plan_update           →  plan
 *   (session/prompt response)    →  turn_done       (payload.stopReason)
 *   session/request_permission   →  approval_request (payload.options)
 *   (its outcome)                →  approval_resolved
 *
 * `error` and `raw` have no ACP counterpart — they carry executor-level
 * failures and unparsed CLI output so nothing is silently dropped.
 *
 * Payload fields are all optional on purpose: rows written before a field
 * existed simply lack it, which is the whole migration story for this table
 * (no backfill, readers tolerate `undefined`).
 */
import type {
  PermissionOption,
  PlanEntry,
  StopReason,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from './acp.ts'
import type { ToolCallRole } from './toolCallRole.ts'
import type { TurnUsage } from './turnUsage.ts'

export type TurnEventKind =
  | 'user'
  | 'assistant'
  /** Agent reasoning (ACP `agent_thought_chunk`); rendered collapsed. */
  | 'thought'
  | 'tool_start'
  | 'tool_result'
  /** The agent's todo list (ACP `plan`), replaced wholesale on each update. */
  | 'plan'
  | 'turn_done'
  | 'error'
  | 'raw'
  /**
   * Token accounting the CLI reported about itself mid-turn. Transient: the
   * executor folds it onto the message row and pushes it live, and it is never
   * written to `turn_events` — it is a gauge, not transcript content.
   */
  | 'usage'
  // Supervised (approval-required) mode: the agent asked to use a tool and is
  // waiting for a human decision, and the decision once it is made.
  | 'approval_request'
  | 'approval_resolved'

export type TurnEventPayload = {
  text?: string
  name?: string
  toolCallId?: string
  input?: unknown
  content?: string
  result?: string
  message?: string
  /** Human-readable tool-call label from the agent (ACP `title`). */
  title?: string
  /** What the tool does — drives the icon (ACP `kind`). */
  toolKind?: ToolKind
  /**
   * Where the call came from for chat chrome: ordinary tool, MCP, skill, or
   * sub-agent. Not an ACP field — inferred from the tool name / envelope so
   * each kind can be styled independently. Optional so older rows still load.
   */
  callRole?: ToolCallRole
  /** MCP server label when known (Claude `mcp__server__…` or Codex `server`). */
  mcpServer?: string
  /** Lifecycle of the tool call (ACP `status`). */
  status?: ToolCallStatus
  /** Files this tool call touched (ACP `locations`). */
  locations?: ToolCallLocation[]
  /** Structured tool output when the agent sends one (ACP `rawOutput`). */
  rawOutput?: unknown
  /** Approval control-protocol correlation id (approval_request/_resolved). */
  requestId?: string
  /** Buttons offered for an approval request (ACP `PermissionOption[]`). */
  options?: PermissionOption[]
  /** Which option the user picked (ACP outcome `optionId`). */
  optionId?: string
  /** Resolution of an approval request. */
  decision?: 'allow' | 'deny'
  /** Why an approval resolved the way it did (e.g. "timed out"). */
  reason?: string
  /** The agent's current todo list (ACP `plan` entries). */
  plan?: PlanEntry[]
  /** Why the turn ended (ACP `stopReason`), when the agent reports one. */
  stopReason?: StopReason
  /** Token counts for the last request (kind `usage`). */
  usage?: Partial<TurnUsage>
}

export type TurnEventRow = {
  id: string
  messageId: string
  runId: string
  seq: number
  kind: TurnEventKind
  /** JSON-encoded TurnEventPayload */
  payload: string
  createdAt: number
}

const MAX_CONVERSATION_EVENT_PAYLOAD_CHARS = 4_000

/**
 * Keep conversation polls light without shortening anything the agent said.
 * Assistant prose and the final result are transcript content, not diagnostic
 * payloads; only oversized work rows may be abbreviated.
 */
export function slimConversationEvent(ev: TurnEventRow): TurnEventRow {
  if (
    ev.payload.length <= MAX_CONVERSATION_EVENT_PAYLOAD_CHARS ||
    ev.kind === 'assistant' ||
    ev.kind === 'turn_done'
  ) {
    return ev
  }
  try {
    const obj = JSON.parse(ev.payload) as Record<string, unknown>
    for (const key of ['content', 'input', 'text', 'result']) {
      const val = obj[key]
      if (typeof val === 'string' && val.length > 1_500) {
        obj[key] = `${val.slice(0, 1_500)}…`
      }
    }
    const next = JSON.stringify(obj)
    if (next.length <= MAX_CONVERSATION_EVENT_PAYLOAD_CHARS) return { ...ev, payload: next }
  } catch {
    // Fall through to a bounded representation of malformed work payloads.
  }
  return {
    ...ev,
    payload: `${ev.payload.slice(0, MAX_CONVERSATION_EVENT_PAYLOAD_CHARS)}…`,
  }
}
