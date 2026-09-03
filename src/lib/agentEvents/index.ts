/**
 * Runtime event adapters — one entry point for "CLI stdout → turn events".
 *
 * Each supported CLI has its own adapter module in this directory; this file
 * dispatches to them and owns the two cross-cutting helpers the executor and
 * `resume.ts` need (forcing machine-readable output, and folding a finished
 * turn's events back into readable chat content).
 *
 * Everything here is pure and browser-safe so `node:test` can exercise the
 * whole parse path without a child process (`lib/` rule).
 */
import type { RuntimeModelKind } from '../models.ts'
import type { TurnEventPayload } from '../turnEvents.ts'
import { parseAntigravityObject } from './antigravity.ts'
import { parseClaudeObject } from './claude.ts'
import { parseCodexObject } from './codex.ts'
import { parseGrokStdoutLine } from './grok.ts'
import type { EventRuntimeKind, ParsedTurnEvent } from './types.ts'

export { AssistantDeltaCoalescer, LineBuffer } from './types.ts'
export type { EventRuntimeKind, ParsedTurnEvent } from './types.ts'
export { parseAcpSessionUpdate } from './acp.ts'
export { extractGrokAssistantText, grokToolOutput, parseGrokObject } from './grok.ts'
export { ClaudeStdoutIngest, parseClaudeObject, parseClaudeStreamEvent } from './claude.ts'
export { parseCodexObject } from './codex.ts'
export { extractAntigravityAssistantText, parseAntigravityObject } from './antigravity.ts'

/**
 * Do we have a stdout adapter for this runtime?
 *
 * Only these kinds emit JSONL we can map. Anything else (a generic runtime, or
 * Gemini's headless CLI, which prints prose) must not be line-split into events
 * — its answer is scraped from stdout instead.
 */
export function hasEventAdapter(kind: EventRuntimeKind): boolean {
  return kind === 'claude' || kind === 'antigravity' || kind === 'codex' || kind === 'grok'
}

/**
 * Map one complete stdout line into zero or more canonical events.
 * Non-JSON lines become a single `raw` event so malformed CLI output still
 * surfaces in the structured stream without aborting the run.
 *
 * Grok is special: pretty-printed / plain answers are not NDJSON envelopes, so
 * non-envelope lines become `assistant` (coalesced into prose) instead of a
 * `raw` pill per line.
 */
export function parseTurnEventLine(line: string, kind: EventRuntimeKind): ParsedTurnEvent[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  if (kind === 'grok') return parseGrokStdoutLine(line)

  if (!trimmed.startsWith('{')) {
    return [{ kind: 'raw', payload: { text: trimmed } }]
  }

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return [{ kind: 'raw', payload: { text: trimmed } }]
  }

  if (kind === 'antigravity') return parseAntigravityObject(obj)
  if (kind === 'claude') return parseClaudeObject(obj)
  if (kind === 'codex') return parseCodexObject(obj)
  return []
}

/** Join assistant texts (and turn_done result as fallback) into chat content. */
export function assistantTextFromEvents(events: Array<{ kind: string; payload: string }>): string {
  const texts: string[] = []
  let doneResult = ''
  for (const ev of events) {
    let payload: TurnEventPayload = {}
    try {
      payload = JSON.parse(ev.payload) as TurnEventPayload
    } catch {
      continue
    }
    if (ev.kind === 'assistant' && payload.text) {
      // Skip consecutive duplicates (legacy rows where Claude `result` was
      // also stored as an assistant event).
      const prev = texts[texts.length - 1]
      if (!prev || prev.trim() !== payload.text.trim()) texts.push(payload.text)
    }
    if (ev.kind === 'turn_done' && payload.result) doneResult = payload.result
  }
  if (texts.length > 0) {
    const joined = texts.join('\n\n').trim()
    const done = doneResult.trim()
    if (done && done !== texts[texts.length - 1]?.trim()) {
      return `${joined}\n\n${done}`
    }
    return joined
  }
  return doneResult.trim()
}

/**
 * Force machine-readable CLI output for Claude/Antigravity/Codex/Grok without
 * rewriting the saved Runtimes row. Users who already chose `json` /
 * `stream-json` / `--json` keep their choice; only the legacy `text` default
 * (and missing flags) change.
 *
 * This keys off the *runtime* kind, not the event kind. Antigravity reuses
 * Claude's stdout adapter (`eventKindFor` maps it to `claude`), but its argv is
 * its own: `agy` defines neither `--verbose` nor `--include-partial-messages`
 * and exits with a usage dump when handed them.
 */
export function ensureMachineReadableArgs(args: string[], kind: RuntimeModelKind): string[] {
  if (kind === 'claude' || kind === 'antigravity') {
    const next = [...args]
    const fmtIdx = next.indexOf('--output-format')
    if (fmtIdx >= 0) {
      const current = next[fmtIdx + 1]
      if (current === 'text') next[fmtIdx + 1] = 'stream-json'
    } else {
      // agy's `-p` consumes the next argv token as the prompt, so the format
      // pair goes before it; Claude's `-p` is a bare flag and tolerates either.
      const pIdx = next.indexOf('-p')
      const insertAt = pIdx >= 0 ? (kind === 'antigravity' ? pIdx : pIdx + 1) : 0
      next.splice(insertAt, 0, '--output-format', 'stream-json')
    }
    if (kind === 'antigravity') return next
    if (!next.includes('--verbose')) next.push('--verbose')
    if (!next.includes('--include-partial-messages')) next.push('--include-partial-messages')
    return next
  }

  if (kind === 'codex') {
    if (args.includes('--json')) return args
    const next = [...args]
    const execIdx = next.indexOf('exec')
    if (execIdx >= 0) {
      next.splice(execIdx + 1, 0, '--json')
      return next
    }
    next.unshift('--json')
    return next
  }

  if (kind === 'grok') {
    const next = [...args]
    const fmtIdx = next.indexOf('--output-format')
    if (fmtIdx >= 0) {
      const current = next[fmtIdx + 1]
      if (current === 'plain' || current === 'text') next[fmtIdx + 1] = 'streaming-json'
    } else {
      next.push('--output-format', 'streaming-json')
    }
    return next
  }

  return args
}
