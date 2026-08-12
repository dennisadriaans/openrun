/**
 * Claude Code bidirectional stream-json control protocol.
 *
 * When Claude runs headless with `--input-format stream-json` and
 * `--permission-prompt-tool stdio`, it asks for tool approval by writing a
 * `control_request` (subtype `can_use_tool`) to stdout, and the host answers
 * by writing a matching `control_response` to stdin. Spike notes live in
 * `changelog.d/03-supervised-approval-spike.md`; core behavior in
 * `changelog.d/03-supervised-approval-core.md`.
 *
 * These helpers are pure string/JSON shaping so both the server executor and
 * unit tests can build/parse the same envelopes without spawning a CLI.
 *
 * This module is now one *responder* behind the shared, ACP-shaped approval
 * model in `lib/approvals.ts`: that module owns the options a prompt offers and
 * what picking one means, and this one knows how to say it in Claude's dialect.
 * `server/acpTurn.ts` is the other responder.
 */
import type { ApprovalDecision } from './approvals.ts'

export type { ApprovalDecision }

export type ControlApprovalRequest = {
  requestId: string
  toolName: string
  input: unknown
}

/**
 * Parse a Claude stdout line object into an approval request, or null when the
 * line is not a `can_use_tool` control request. The caller has already
 * JSON-parsed the NDJSON line.
 */
export function parseControlRequest(obj: Record<string, unknown>): ControlApprovalRequest | null {
  if (obj.type !== 'control_request') return null
  const request = obj.request as Record<string, unknown> | undefined
  if (request?.subtype !== 'can_use_tool') return null

  const requestId =
    (typeof obj.request_id === 'string' && obj.request_id) ||
    (typeof request.request_id === 'string' && request.request_id) ||
    ''
  const toolName =
    (typeof request.tool_name === 'string' && request.tool_name) ||
    (typeof request.name === 'string' && request.name) ||
    'tool'
  return { requestId, toolName, input: request.input }
}

/**
 * Build the `control_response` envelope the host writes to Claude's stdin.
 * Allow may carry an `updatedInput`; deny carries a human-readable message.
 * Returns a single NDJSON line **with** its trailing newline so the caller can
 * write it directly to the child's stdin.
 */
export function buildControlResponse(input: {
  requestId: string
  decision: ApprovalDecision
  updatedInput?: unknown
  message?: string
}): string {
  const response: Record<string, unknown> =
    input.decision === 'allow'
      ? {
          subtype: 'success',
          behavior: 'allow',
          ...(input.updatedInput !== undefined ? { updatedInput: input.updatedInput } : {}),
        }
      : {
          subtype: 'success',
          behavior: 'deny',
          message: input.message ?? 'Denied by supervisor',
        }

  const envelope = {
    type: 'control_response',
    request_id: input.requestId,
    response,
  }
  return `${JSON.stringify(envelope)}\n`
}

/**
 * Build the stream-json user-message envelope. With `--input-format stream-json`
 * the prompt cannot be raw text on stdin — it must be a `user` message object.
 * Returns an NDJSON line with a trailing newline.
 */
export function buildStreamJsonUserMessage(prompt: string): string {
  const envelope = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: prompt }],
    },
  }
  return `${JSON.stringify(envelope)}\n`
}
