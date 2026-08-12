/**
 * Agent Client Protocol (ACP) vocabulary — the canonical shape of everything a
 * coding agent tells us during a turn.
 *
 * Why this exists: every CLI we drive (`claude --output-format stream-json`,
 * `codex exec --json`, `grok --output-format streaming-json`) invents its own
 * JSON envelope, and we used to invent a fourth vocabulary to normalize them
 * into. ACP is the published standard for exactly this — a tool call has a
 * `title`, a `kind`, a `status` and file `locations`; a permission request is an
 * options list with an outcome — so we normalize onto its names instead of ours.
 *
 * This module is a hand-written **subset** of the protocol: the parts a chat
 * transcript needs, and nothing else. It is deliberately dependency-free so it
 * runs in the browser (`lib/` rule) — `acpConformance.ts` type-checks these
 * declarations against the real `@agentclientprotocol/sdk` types so the subset
 * cannot silently drift from the spec.
 *
 * Spec: https://agentclientprotocol.com/protocol/schema
 */

/** What a tool call is doing, for iconography and grouping. */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'switch_mode'
  | 'other'

/** Lifecycle of a tool call. Anything but pending/in_progress is settled. */
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** A file (and optionally line) a tool call touched — "follow-along" data. */
export type ToolCallLocation = {
  path: string
  line?: number
}

/** Hint about what picking a permission option means. */
export type PermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always'

/** One button on an approval prompt. */
export type PermissionOption = {
  optionId: string
  name: string
  kind: PermissionOptionKind
}

/** The user's answer to an approval prompt. */
export type PermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' }

export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed'
export type PlanEntryPriority = 'high' | 'medium' | 'low'

/** One line of the agent's plan / todo list. */
export type PlanEntry = {
  content: string
  priority: PlanEntryPriority
  status: PlanEntryStatus
}

/** Why a prompt turn ended. */
export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled'

export const TOOL_KINDS: readonly ToolKind[] = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]

export const TOOL_CALL_STATUSES: readonly ToolCallStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
]

/** True once a tool call can no longer change (no spinner, show the result). */
export function isSettledToolStatus(status: ToolCallStatus | undefined): boolean {
  return status === 'completed' || status === 'failed'
}

export function isToolKind(value: unknown): value is ToolKind {
  return typeof value === 'string' && (TOOL_KINDS as readonly string[]).includes(value)
}

export function isToolCallStatus(value: unknown): value is ToolCallStatus {
  return (
    typeof value === 'string' && (TOOL_CALL_STATUSES as readonly string[]).includes(value)
  )
}

/**
 * Best-effort `ToolKind` for a CLI tool name.
 *
 * Claude and Codex do not send a kind — Claude reports `Bash`/`Read`/`Edit`,
 * Codex reports `command_execution` — so we infer one rather than render every
 * call with the same generic wrench. Grok and ACP agents send a real kind and
 * never reach this function.
 */
export function toolKindFromName(name: string | undefined): ToolKind {
  const n = (name ?? '').toLowerCase()
  if (!n) return 'other'
  if (
    n === 'bash' ||
    n === 'shell' ||
    n === 'command_execution' ||
    n === 'bashoutput' ||
    n.includes('terminal') ||
    n.includes('execute')
  ) {
    return 'execute'
  }
  if (n === 'read' || n === 'notebookread' || n === 'view' || n.startsWith('read')) return 'read'
  if (
    n === 'edit' ||
    n === 'write' ||
    n === 'multiedit' ||
    n === 'notebookedit' ||
    n === 'applypatch' ||
    n === 'apply_patch' ||
    n === 'file_change' ||
    n === 'patch' ||
    n.startsWith('edit') ||
    n.startsWith('write')
  ) {
    return 'edit'
  }
  if (n === 'grep' || n === 'glob' || n === 'search' || n === 'ls' || n === 'listdir') {
    return 'search'
  }
  if (n === 'websearch' || n === 'webfetch' || n === 'web_search' || n === 'fetch') return 'fetch'
  if (
    n === 'task' ||
    n === 'agent' ||
    n === 'subagent' ||
    n === 'todowrite' ||
    n === 'think' ||
    n === 'reasoning' ||
    n === 'skill'
  ) {
    return 'think'
  }
  if (n === 'delete' || n === 'rm') return 'delete'
  if (n === 'move' || n === 'rename' || n === 'mv') return 'move'
  if (n.startsWith('mcp__') || n.startsWith('mcp_') || n.startsWith('mcp.')) return 'other'
  return 'other'
}

/**
 * Human title for a tool call when the agent did not supply one.
 * ACP agents always send `title`; the JSONL CLIs do not.
 */
export function toolCallTitle(name: string | undefined, summary: string): string {
  const base = name?.trim() || 'tool'
  const detail = summary.trim()
  return detail ? `${base} · ${detail}` : base
}
