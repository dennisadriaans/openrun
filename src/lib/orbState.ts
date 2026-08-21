/**
 * Map an in-flight turn onto a thinking-orbs state.
 * Kept in `lib/` with no package import so node:test can exercise the table.
 */
import type { ToolKind } from './acp.ts'
import type { ToolCallRole } from './toolCallRole.ts'

export const ORB_STATES = [
  'working',
  'searching',
  'solving',
  'listening',
  'connecting',
  'weaving',
  'composing',
  'breathing',
  'shaping',
] as const

export type ActivityOrbState = (typeof ORB_STATES)[number]

export function isActivityOrbState(value: unknown): value is ActivityOrbState {
  return typeof value === 'string' && (ORB_STATES as readonly string[]).includes(value)
}

/** Orb for an in-flight tool / MCP / skill / sub-agent call. */
export function orbStateForTool(input: {
  toolKind?: ToolKind
  callRole?: ToolCallRole
}): ActivityOrbState {
  if (input.callRole === 'mcp') return 'connecting'
  if (input.callRole === 'subagent') return 'weaving'
  if (input.callRole === 'skill') return 'working'
  switch (input.toolKind) {
    case 'read':
    case 'search':
    case 'fetch':
      return 'searching'
    case 'edit':
    case 'delete':
    case 'move':
      return 'shaping'
    case 'think':
      return 'solving'
    case 'switch_mode':
      return 'connecting'
    default:
      return 'working'
  }
}

/** Timer prefix that matches the orb without repeating a detailed step. */
export function orbVerb(state: ActivityOrbState): string {
  switch (state) {
    case 'searching':
      return 'Searching'
    case 'solving':
      return 'Thinking'
    case 'listening':
      return 'Waiting'
    case 'connecting':
      return 'Connecting'
    case 'weaving':
      return 'Delegating'
    case 'composing':
      return 'Writing'
    case 'breathing':
      return 'Starting'
    case 'shaping':
      return 'Editing'
    default:
      return 'Working'
  }
}

/**
 * Fold consecutive thought snapshots (Codex `item.updated`) without doubling
 * Grok/ACP deltas that were already concatenated by the coalescer.
 */
export function mergeThoughtText(prev: string, next: string): string {
  const a = prev.trimEnd()
  const b = next.trim()
  if (!b) return prev
  if (!a) return next
  if (b.startsWith(a)) return next
  if (a.startsWith(b)) return prev
  return `${a}\n\n${b}`
}
