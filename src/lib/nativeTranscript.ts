/**
 * Native CLI transcript → chat turns. Parse-only, browser-safe.
 *
 * `nativeSessions.ts` reads each store's *index* for the picker; this module
 * reads the body, so adopting a saved chat can render the whole conversation in
 * Open Run instead of a one-line "resumed" note. The server half locates the
 * files.
 *
 * Reading a transcript is independent of resuming one: a session id only loads
 * back into the CLI that wrote it, but its text renders anywhere.
 *
 * Claude's session JSONL carries the same envelopes its `stream-json` stdout
 * does, so `agentEvents/claude.ts` does the parsing here too — only turn
 * segmentation and the TUI-only line types are new.
 */
import { parseClaudeObject } from './agentEvents/claude.ts'
import type { ParsedTurnEvent } from './agentEvents/types.ts'
import { toolResultContent } from './agentEvents/types.ts'
import { toolKindFromName } from './acp.ts'
import {
  isSkippableUserText,
  parseIsoMs,
  userTextFromContent,
  type NativeSessionKind,
} from './nativeSessions.ts'

/** CLIs whose saved chats we can render. The rest still resume, without history. */
export const TRANSCRIPT_IMPORT_KINDS = ['claude', 'codex', 'grok', 'antigravity'] as const

/** Keep an adopted chat from dwarfing the run it lands in; oldest turns go first. */
export const MAX_IMPORT_TURNS = 200
export const MAX_IMPORT_EVENTS = 4_000

export type TranscriptTurn = {
  /** User text that opened the turn; empty when the file starts mid-turn. */
  prompt: string
  promptAt: number
  events: ParsedTurnEvent[]
  endedAt: number
}

export function supportsTranscriptImport(kind: string): kind is NativeSessionKind {
  return (TRANSCRIPT_IMPORT_KINDS as readonly string[]).includes(kind)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * `~/.claude/projects/<cwd>/<sessionId>.jsonl` → one turn per user prompt.
 *
 * Lines are Anthropic envelopes (`type: user | assistant`) mixed with TUI
 * bookkeeping (`ai-title`, `mode`, `attachment`, …) that has no chat meaning.
 * A `user` line is either a real prompt — which opens a turn — or the
 * `tool_result` half of the previous assistant message.
 */
export function parseClaudeTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn | null = null

  const open = (prompt: string, at: number): TranscriptTurn => {
    const turn: TranscriptTurn = { prompt, promptAt: at, events: [], endedAt: at }
    turns.push(turn)
    return turn
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = asRecord(parsed)
    if (!rec) continue
    // A sub-agent's transcript belongs to the tool call that spawned it.
    if (rec.isSidechain === true) continue
    const type = rec.type
    if (type !== 'user' && type !== 'assistant') continue

    const stamp = typeof rec.timestamp === 'string' ? rec.timestamp : ''
    const at = parseIsoMs(stamp) ?? current?.endedAt ?? 0

    if (type === 'user') {
      const results = parseClaudeObject(rec)
      if (results.length > 0) {
        if (current) {
          current.events.push(...results)
          current.endedAt = at
        }
        continue
      }
      if (rec.isMeta === true) continue
      const message = asRecord(rec.message)
      const prompt = userTextFromContent(message?.content ?? rec.content)
      if (isSkippableUserText(prompt)) continue
      current = open(prompt, at)
      continue
    }

    const events = parseClaudeObject(rec)
    if (events.length === 0) continue
    if (!current) current = open('', at)
    for (const event of events) current.events.push(event)
    current.endedAt = at
  }

  // Claude writes no `result` line to the session file, so close each answered
  // turn ourselves — chat treats a turn without one as still in flight.
  for (const turn of turns) {
    if (turn.events.length > 0) {
      turn.events.push({ kind: 'turn_done', payload: { stopReason: 'end_turn' } })
    }
  }

  return turns.filter((turn) => turn.prompt.length > 0 || turn.events.length > 0)
}

function codexMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      const block = asRecord(item)
      return block && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function codexInput(input: unknown): unknown {
  if (typeof input !== 'string') return input
  try {
    return JSON.parse(input) as unknown
  } catch {
    return input
  }
}

function codexReasoningText(payload: Record<string, unknown>): string {
  if (typeof payload.summary === 'string') return payload.summary
  if (!Array.isArray(payload.summary)) return ''
  return payload.summary
    .map((item) => {
      const part = asRecord(item)
      return part && typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

/** Codex rollout JSONL → the same turn model used by imported Claude chats. */
export function parseCodexTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn | null = null

  const open = (prompt: string, at: number): TranscriptTurn => {
    const turn: TranscriptTurn = { prompt, promptAt: at, events: [], endedAt: at }
    turns.push(turn)
    return turn
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const rec = asRecord(parsed)
    const payload = rec ? asRecord(rec.payload) : null
    if (!rec || !payload) continue
    const at =
      parseIsoMs(typeof rec.timestamp === 'string' ? rec.timestamp : '') ?? current?.endedAt ?? 0

    if (rec.type === 'event_msg' && payload.type === 'token_count' && current) {
      current.endedAt = at
      continue
    }
    if (rec.type !== 'response_item') continue

    if (payload.type === 'message') {
      const text = codexMessageText(payload.content).trim()
      if (!text) continue
      if (payload.role === 'user') {
        if (isSkippableUserText(text) || isCodexContext(text)) continue
        current = open(text, at)
      } else if (payload.role === 'assistant') {
        if (!current) current = open('', at)
        current.events.push({ kind: 'assistant', payload: { text } })
        current.endedAt = at
      }
      continue
    }

    if (!current) continue
    if (payload.type === 'reasoning') {
      const reasoning = codexReasoningText(payload)
      if (reasoning) current.events.push({ kind: 'thought', payload: { text: reasoning } })
    } else if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
      const name = typeof payload.name === 'string' ? payload.name : 'tool'
      current.events.push({
        kind: 'tool_start',
        payload: {
          toolCallId: typeof payload.call_id === 'string' ? payload.call_id : undefined,
          name,
          title: name,
          toolKind: toolKindFromName(name),
          status: 'in_progress',
          input: codexInput(payload.input ?? payload.arguments),
        },
      })
    } else if (
      payload.type === 'custom_tool_call_output' ||
      payload.type === 'function_call_output'
    ) {
      current.events.push({
        kind: 'tool_result',
        payload: {
          toolCallId: typeof payload.call_id === 'string' ? payload.call_id : undefined,
          status: 'completed',
          content: toolResultContent(payload.output),
        },
      })
    }
    current.endedAt = at
  }

  for (const turn of turns) {
    if (turn.events.length > 0) {
      turn.events.push({ kind: 'turn_done', payload: { stopReason: 'end_turn' } })
    }
  }
  return turns.filter((turn) => turn.prompt.length > 0 || turn.events.length > 0)
}

function isCodexContext(text: string): boolean {
  return text.includes('<environment_context>') || text.includes('<permissions instructions>')
}

function parseToolInput(value: unknown): unknown {
  return codexInput(value)
}

function toolStart(name: string, id: string | undefined, input: unknown): ParsedTurnEvent {
  return {
    kind: 'tool_start',
    payload: {
      toolCallId: id,
      name,
      title: name,
      toolKind: toolKindFromName(name),
      status: 'in_progress',
      input: parseToolInput(input),
    },
  }
}

/** Grok `chat_history.jsonl` → imported turns. */
export function parseGrokTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn | null = null
  const open = (prompt: string): TranscriptTurn => {
    const turn: TranscriptTurn = { prompt, promptAt: 0, events: [], endedAt: 0 }
    turns.push(turn)
    return turn
  }

  for (const line of text.split('\n')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const rec = asRecord(parsed)
    if (!rec) continue
    if (rec.type === 'user') {
      if (rec.synthetic_reason) continue
      const prompt = codexMessageText(rec.content).trim()
      if (prompt && !isSkippableUserText(prompt)) current = open(prompt)
      continue
    }
    if (!current) continue
    if (rec.type === 'reasoning') {
      const reasoning = codexReasoningText(rec)
      if (reasoning) current.events.push({ kind: 'thought', payload: { text: reasoning } })
      continue
    }
    if (rec.type === 'assistant') {
      if (typeof rec.content === 'string' && rec.content.trim()) {
        current.events.push({ kind: 'assistant', payload: { text: rec.content } })
      }
      if (Array.isArray(rec.tool_calls)) {
        for (const item of rec.tool_calls) {
          const call = asRecord(item)
          if (!call) continue
          const fn = asRecord(call.function)
          const name =
            (typeof call.name === 'string' && call.name) ||
            (fn && typeof fn.name === 'string' ? fn.name : '') ||
            'tool'
          const id =
            (typeof call.id === 'string' && call.id) ||
            (typeof call.call_id === 'string' ? call.call_id : undefined)
          current.events.push(toolStart(name, id, call.arguments ?? fn?.arguments))
        }
      }
      continue
    }
    if (rec.type === 'tool_result') {
      current.events.push({
        kind: 'tool_result',
        payload: {
          toolCallId:
            typeof rec.tool_call_id === 'string'
              ? rec.tool_call_id
              : typeof rec.call_id === 'string'
                ? rec.call_id
                : undefined,
          status: 'completed',
          content: toolResultContent(rec.content),
        },
      })
    }
  }
  for (const turn of turns) {
    if (turn.events.length > 0) {
      turn.events.push({ kind: 'turn_done', payload: { stopReason: 'end_turn' } })
    }
  }
  return turns
}

/** Antigravity rendered transcript JSONL → imported turns. */
export function parseAntigravityTranscript(text: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let current: TranscriptTurn | null = null
  let toolIndex = 0
  let openToolId: string | undefined

  for (const line of text.split('\n')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const rec = asRecord(parsed)
    if (!rec) continue
    const at = parseIsoMs(typeof rec.created_at === 'string' ? rec.created_at : '') ?? 0
    if (rec.type === 'USER_INPUT' && typeof rec.content === 'string' && rec.content.trim()) {
      current = {
        prompt: rec.content.trim(),
        promptAt: at,
        events: [],
        endedAt: at,
      }
      turns.push(current)
      openToolId = undefined
      continue
    }
    if (!current || rec.source !== 'MODEL') continue
    if (typeof rec.content === 'string' && rec.content.trim()) {
      if (rec.type === 'GENERIC' && openToolId) {
        current.events.push({
          kind: 'tool_result',
          payload: { toolCallId: openToolId, status: 'completed', content: rec.content },
        })
        openToolId = undefined
      } else {
        current.events.push({ kind: 'assistant', payload: { text: rec.content } })
      }
    }
    if (Array.isArray(rec.tool_calls)) {
      for (const item of rec.tool_calls) {
        const call = asRecord(item)
        if (!call) continue
        const name = typeof call.name === 'string' ? call.name : 'tool'
        openToolId = `antigravity-${toolIndex++}`
        current.events.push(toolStart(name, openToolId, call.args))
      }
    }
    current.endedAt = at
  }
  for (const turn of turns) {
    if (turn.events.length > 0) {
      turn.events.push({ kind: 'turn_done', payload: { stopReason: 'end_turn' } })
    }
  }
  return turns
}

/**
 * Drop the oldest turns until the transcript fits the import caps.
 *
 * Turns are atomic for the event cap: an oversized turn is omitted along with
 * every older turn instead of being sliced through a tool_start/tool_result
 * pair or its final turn_done. This keeps the imported ACP event stream
 * structurally coherent while still respecting the global cap.
 */
export function trimTranscript(
  turns: readonly TranscriptTurn[],
  limits?: { maxTurns?: number; maxEvents?: number },
): { turns: TranscriptTurn[]; dropped: number; droppedEvents: number } {
  const maxTurns = limits?.maxTurns ?? MAX_IMPORT_TURNS
  const maxEvents = limits?.maxEvents ?? MAX_IMPORT_EVENTS
  const kept: TranscriptTurn[] = []
  let events = 0
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i]!
    if (kept.length >= maxTurns) break
    const remaining = maxEvents - events
    if (remaining <= 0) break
    if (turn.events.length > remaining) {
      // A partial turn can orphan a tool result or turn_done. Omit this turn
      // and all older history; the result remains a contiguous newest suffix.
      break
    }
    kept.unshift(turn)
    events += turn.events.length
  }
  const dropped = turns.length - kept.length
  const droppedEvents = turns
    .slice(0, dropped)
    .reduce((count, turn) => count + turn.events.length, 0)
  return { turns: kept, dropped, droppedEvents }
}

/** System-message note for the turns that did not fit. */
export function omittedTurnsNote(dropped: number, droppedEvents = 0): string {
  const turns = `${dropped} earlier turn${dropped === 1 ? '' : 's'}`
  if (droppedEvents <= 0) {
    return `${turns} not shown — open the chat in the CLI for the full history.`
  }
  if (dropped <= 0) {
    return `${droppedEvents} event${droppedEvents === 1 ? '' : 's'} not shown — open the chat in the CLI for the full history.`
  }
  return `${turns} and ${droppedEvents} event${droppedEvents === 1 ? '' : 's'} not shown — open the chat in the CLI for the full history.`
}
