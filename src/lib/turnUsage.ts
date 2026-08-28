/**
 * Live per-turn token accounting — parse-only, browser-safe.
 *
 * `lib/usage.ts` answers "how much have I spent this week" by walking each
 * CLI's history on disk. This module answers the other question, the one you
 * need *during* a run: how full is the context window right now, and how much
 * of it came back from cache. The numbers come from whatever the CLI streams
 * about itself — Claude's per-message `usage`, Codex's `token_count`, Grok's
 * `usage` envelope, ACP's `usage_update` — so a runtime that reports nothing
 * simply has no readout rather than a zero pretending to be a measurement.
 */

export type TurnUsage = {
  /** Fresh input tokens on the most recent request. */
  input: number
  output: number
  /** Context served from cache — the cheap part of `input`. */
  cacheRead: number
  /** Tokens written into the cache on this request. */
  cacheWrite: number
  /**
   * What the model actually carried on its last request. CLIs that report it
   * win; otherwise it is the sum of the parts above.
   */
  contextTokens: number
  /** Context window of the model, when the CLI or the table below knows it. */
  contextLimit: number | null
  /** Model the counts belong to, when reported. */
  model: string
}

/** Above this share of the window, the readout warns. */
export const CONTEXT_WARN_PERCENT = 75
/** Above this, it is time to clear or restart the conversation. */
export const CONTEXT_DANGER_PERCENT = 90

/**
 * Fallback context windows, matched on a substring of the model slug.
 *
 * A CLI-reported limit always wins — this only exists so the ones that report
 * counts but no window (Claude, Grok) still get a percentage. Longest match
 * wins, so a `[1m]` variant beats its base model.
 */
const CONTEXT_WINDOWS: Array<[match: string, tokens: number]> = [
  ['sonnet[1m]', 1_000_000],
  ['claude', 200_000],
  ['opus', 200_000],
  ['sonnet', 200_000],
  ['haiku', 200_000],
  ['gpt-5', 400_000],
  ['codex', 400_000],
  ['o3', 200_000],
  ['grok', 256_000],
  ['gemini', 1_048_576],
]

export function contextLimitForModel(model: string): number | null {
  const slug = model.trim().toLowerCase()
  if (!slug) return null
  let best: [string, number] | null = null
  for (const entry of CONTEXT_WINDOWS) {
    if (!slug.includes(entry[0])) continue
    if (!best || entry[0].length > best[0].length) best = entry
  }
  return best ? best[1] : null
}

export function emptyTurnUsage(): TurnUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: 0,
    contextLimit: null,
    model: '',
  }
}

export function isEmptyTurnUsage(usage: TurnUsage | null | undefined): boolean {
  return !usage || (usage.contextTokens <= 0 && usage.input <= 0 && usage.output <= 0)
}

/**
 * Fold a fresh frame onto what we already knew.
 *
 * A frame is a *snapshot* of the last request, not a delta, so the newer
 * numbers replace the older ones. Fields the frame leaves out keep their last
 * known value — CLIs report the model and the window once and then stop.
 */
export function mergeTurnUsage(prev: TurnUsage | null, next: Partial<TurnUsage>): TurnUsage {
  const base = prev ?? emptyTurnUsage()
  const merged: TurnUsage = {
    input: pickNumber(next.input, base.input),
    output: pickNumber(next.output, base.output),
    cacheRead: pickNumber(next.cacheRead, base.cacheRead),
    cacheWrite: pickNumber(next.cacheWrite, base.cacheWrite),
    contextTokens: pickNumber(next.contextTokens, 0),
    contextLimit: next.contextLimit ?? base.contextLimit,
    model: next.model || base.model,
  }
  if (merged.contextTokens <= 0) {
    const derived = merged.input + merged.cacheRead + merged.cacheWrite + merged.output
    merged.contextTokens = derived > 0 ? derived : base.contextTokens
  }
  if (merged.contextLimit === null) merged.contextLimit = contextLimitForModel(merged.model)
  return merged
}

function pickNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** 0–100, or null when nobody knows the window. */
export function contextPercent(usage: TurnUsage): number | null {
  if (!usage.contextLimit || usage.contextLimit <= 0) return null
  return Math.min(100, (usage.contextTokens / usage.contextLimit) * 100)
}

export type ContextPressure = 'ok' | 'warn' | 'danger'

export function contextPressure(usage: TurnUsage): ContextPressure {
  const pct = contextPercent(usage)
  if (pct === null) return 'ok'
  if (pct >= CONTEXT_DANGER_PERCENT) return 'danger'
  if (pct >= CONTEXT_WARN_PERCENT) return 'warn'
  return 'ok'
}

/** Share of the context that came back from cache, 0–100. */
export function cachedPercent(usage: TurnUsage): number | null {
  if (usage.contextTokens <= 0) return null
  return Math.min(100, (usage.cacheRead / usage.contextTokens) * 100)
}

/** Tolerant read of a stored `messages.usage` blob. */
export function parseTurnUsage(raw: string | null | undefined): TurnUsage | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw) as Partial<TurnUsage>
    if (!obj || typeof obj !== 'object') return null
    return mergeTurnUsage(null, obj)
  } catch {
    return null
  }
}
