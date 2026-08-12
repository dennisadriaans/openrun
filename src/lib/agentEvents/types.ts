/**
 * Shared plumbing for the per-runtime event adapters.
 *
 * Each adapter in this directory turns one CLI's stdout into ACP-shaped
 * `ParsedTurnEvent`s (see `lib/turnEvents.ts` for the vocabulary). The
 * line/delta buffering below is CLI-agnostic and lives here so the adapters
 * stay pure `object → events` functions that unit tests can call directly.
 */
import type { ToolCallLocation } from '../acp.ts'
import type { TurnEventKind, TurnEventPayload } from '../turnEvents.ts'

/** Runtimes we have a real adapter for; everything else is `generic`. */
export type EventRuntimeKind = 'claude' | 'codex' | 'grok' | 'gemini' | 'generic'

export type ParsedTurnEvent = {
  kind: TurnEventKind
  payload: TurnEventPayload
}

/** Buffer arbitrary stdout chunks into complete newline-delimited lines. */
export class LineBuffer {
  private buf = ''

  push(chunk: string): string[] {
    this.buf += chunk
    const lines: string[] = []
    while (true) {
      const idx = this.buf.indexOf('\n')
      if (idx < 0) break
      lines.push(this.buf.slice(0, idx))
      this.buf = this.buf.slice(idx + 1)
    }
    return lines
  }

  /** Remaining unterminated bytes (caller may treat as a final line on close). */
  flush(): string {
    const rest = this.buf
    this.buf = ''
    return rest
  }
}

/**
 * Buffer assistant/thought text deltas so chat stores one prose event per
 * contiguous stretch (until a tool / error / turn_done) instead of one row per
 * token. Grok and ACP agents stream token-sized chunks; Claude and Codex send
 * whole messages and never need this.
 */
export class AssistantDeltaCoalescer {
  private buf = ''
  private kind: TurnEventKind = 'assistant'

  push(events: ParsedTurnEvent[]): ParsedTurnEvent[] {
    const out: ParsedTurnEvent[] = []
    for (const ev of events) {
      const isProse = ev.kind === 'assistant' || ev.kind === 'thought'
      if (isProse && typeof ev.payload.text === 'string') {
        // A switch between thinking and answering closes the current stretch.
        if (this.buf && ev.kind !== this.kind) {
          out.push({ kind: this.kind, payload: { text: this.buf } })
          this.buf = ''
        }
        this.kind = ev.kind
        this.buf += ev.payload.text
        continue
      }
      if (this.buf) {
        out.push({ kind: this.kind, payload: { text: this.buf } })
        this.buf = ''
      }
      out.push(ev)
    }
    return out
  }

  flush(): ParsedTurnEvent[] {
    if (!this.buf) return []
    const text = this.buf
    this.buf = ''
    return [{ kind: this.kind, payload: { text } }]
  }
}

/** Text out of an MCP-style content-block array (or a bare string). */
export function textFromContentBlocks(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('')
}

/** Human-readable rendering of whatever a tool handed back. */
export function toolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return textFromContentBlocks(content)
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/** First string among `keys` on a record, or undefined. */
export function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/**
 * Recover ACP `locations` from a JSONL tool input.
 *
 * Claude and Codex do not send them, but their tool inputs carry the path under
 * a handful of well-known keys — enough for the transcript to say which file a
 * call touched. ACP agents send real locations and skip this.
 */
export function locationsFromToolInput(input: unknown): ToolCallLocation[] | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const obj = input as Record<string, unknown>
  const path = pickString(obj, 'file_path', 'filePath', 'path', 'target_file', 'notebook_path')
  if (!path) return undefined
  const rawLine = obj.line ?? obj.line_number ?? obj.offset
  const line = typeof rawLine === 'number' && Number.isFinite(rawLine) ? rawLine : undefined
  return [line === undefined ? { path } : { path, line }]
}

/** One-line detail for a tool-call title (command, path, pattern…). */
export function toolInputSummary(name: string | undefined, input: unknown): string {
  if (input == null) return ''
  if (typeof input === 'string') return input.slice(0, 120)
  if (typeof input !== 'object') return String(input).slice(0, 120)
  const obj = input as Record<string, unknown>

  const lower = (name ?? '').toLowerCase()
  if (lower === 'bash' || lower === 'command_execution' || lower === 'shell') {
    return (pickString(obj, 'command', 'cmd') ?? '').slice(0, 120)
  }
  if (lower === 'skill' || lower === 'invoke_skill' || lower === 'skills') {
    return (pickString(obj, 'skill', 'skill_name', 'skillName', 'name') ?? '').slice(0, 120)
  }
  if (
    lower === 'task' ||
    lower === 'agent' ||
    lower === 'subagent' ||
    lower === 'spawn_agent' ||
    lower === 'tasktool'
  ) {
    return (
      pickString(obj, 'description', 'title', 'subagent_type', 'subagentType', 'name') ?? ''
    ).slice(0, 120)
  }
  const picked = pickString(
    obj,
    'command',
    'file_path',
    'filePath',
    'path',
    'target_file',
    'pattern',
    'query',
    'description',
  )
  return (picked ?? '').slice(0, 120)
}
