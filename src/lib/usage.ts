/**
 * Usage vocabulary — parse-only, browser-safe.
 *
 * `/usage` inside a CLI reads that CLI's own accounting. Open Run has no such
 * channel, so the server module walks each CLI's on-disk history instead and
 * these helpers turn what it finds into one shape. What a CLI records varies a
 * lot: Codex writes real rate-limit windows, Claude writes per-message token
 * usage but nothing about its plan, and Grok/Gemini/Antigravity write no token
 * counts at all. `status` and `note` carry that difference to the UI rather
 * than letting a zero pretend to be a measurement.
 */

export type UsageTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

export type UsageModelRow = {
  model: string
  tokens: UsageTokens
  /** null when the model is not in the price table below. */
  costUsd: number | null
}

/** Claude reports a per-model weekly limit alongside the all-model one. */
export type UsageWindowId = 'session' | 'weekly' | 'weekly-opus' | 'weekly-sonnet'

export type UsageWindow = {
  id: UsageWindowId
  label: string
  windowMinutes: number
  tokens: number
  /** 0–100 when the CLI reports its own limit; null when we only know tokens. */
  usedPercent: number | null
  startedAt: number | null
  resetsAt: number | null
  /** true when the CLI itself reported the number, false when we derived it. */
  reported: boolean
  /** Current pace and where it lands at the window's end, or null too early to say. */
  tokensPerHour: number | null
  projectedTokens: number | null
  projectedPercent: number | null
}

export type UsageDay = { date: string; tokens: number; costUsd: number | null }

/** A folder the CLI was run in, resolved against Open Run's projects when it can be. */
export type UsageProject = {
  path: string
  label: string
  /** Set when the folder is inside a project (or one of its worktrees). */
  projectId: string
  tokens: number
  costUsd: number | null
  sessions: number
}

export type UsageRange = '7d' | '30d' | 'all'

export const USAGE_RANGES: Array<{ id: UsageRange; label: string; days: number }> = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: 'all', label: 'All time', days: 0 },
]

export function parseUsageRange(value: string | null | undefined): UsageRange {
  return USAGE_RANGES.some((r) => r.id === value) ? (value as UsageRange) : '30d'
}

export function rangeCutoff(range: UsageRange, now: number): number {
  const days = USAGE_RANGES.find((r) => r.id === range)?.days ?? 0
  return days > 0 ? now - days * 86_400_000 : 0
}

export type UsageStatus = 'ok' | 'empty' | 'no-token-data' | 'unsupported' | 'not-installed'

export type RuntimeUsage = {
  runtimeId: string
  label: string
  bin: string
  kind: string
  transport: string
  installed: boolean
  status: UsageStatus
  /** Where the numbers came from, e.g. `~/.claude/projects`. */
  source: string
  note: string
  tokens: UsageTokens
  totalTokens: number
  costUsd: number | null
  /** Tokens from models with no entry in the price table. */
  unpricedTokens: number
  models: UsageModelRow[]
  daily: UsageDay[]
  windows: UsageWindow[]
  projects: UsageProject[]
  sessions: number
  messages: number
  lastUsedAt: number | null
  plan: string
  /** Runs Open Run itself started on this runtime, inside the range. */
  openRunRuns: number
}

export type UsageReport = {
  generatedAt: number
  scanMs: number
  range: UsageRange
  runtimes: RuntimeUsage[]
  /** Top folders across every CLI — where the tokens actually went. */
  projects: UsageProject[]
  totals: {
    tokens: number
    costUsd: number
    unpricedTokens: number
    sessions: number
    openRunRuns: number
  }
}

/**
 * The one number worth showing without opening the page: the tightest limit a
 * CLI is reporting about itself right now. Cheap enough to poll.
 */
export type UsagePressure = {
  /** 0–100, or null when no CLI on this machine reports a limit. */
  usedPercent: number | null
  label: string
  runtime: string
  resetsAt: number | null
}

/** Above this, the account menu shows the number instead of hiding it. */
export const PRESSURE_BADGE_THRESHOLD = 70

export const SESSION_WINDOW_MINUTES = 300
export const WEEKLY_WINDOW_MINUTES = 10_080
export const DAILY_HISTORY_DAYS = 30
/** How far back the server keeps per-message samples for window math. */
export const SAMPLE_RETENTION_DAYS = 9

export function emptyTokens(): UsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
}

export function addTokens(into: UsageTokens, add: Partial<UsageTokens>): UsageTokens {
  into.input += add.input ?? 0
  into.output += add.output ?? 0
  into.cacheRead += add.cacheRead ?? 0
  into.cacheWrite5m += add.cacheWrite5m ?? 0
  into.cacheWrite1h += add.cacheWrite1h ?? 0
  return into
}

export function totalTokens(t: UsageTokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
}

export type ModelPrice = { input: number; output: number }

/**
 * USD per million tokens, Anthropic list prices (checked 2026-06-24). Cache
 * reads bill at 0.1x input, 5-minute cache writes at 1.25x and 1-hour writes
 * at 2x. Non-Anthropic CLIs are deliberately absent: Codex and Grok bill by
 * subscription here, and quoting a per-token price we have not verified would
 * be worse than showing none. Add rows to price them.
 */
const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-mythos-preview': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
}

const PRICE_KEYS = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length)

export function priceForModel(model: string): ModelPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  for (const key of PRICE_KEYS) {
    if (id.startsWith(key)) return MODEL_PRICES[key]!
  }
  return null
}

export function costForTokens(model: string, t: UsageTokens): number | null {
  const price = priceForModel(model)
  if (!price) return null
  const perToken = price.input / 1_000_000
  return (
    t.input * perToken +
    (t.output * price.output) / 1_000_000 +
    t.cacheRead * perToken * 0.1 +
    t.cacheWrite5m * perToken * 1.25 +
    t.cacheWrite1h * perToken * 2
  )
}

/** One priced row per model, biggest spender first. */
export function modelRows(byModel: Map<string, UsageTokens>): UsageModelRow[] {
  const rows: UsageModelRow[] = []
  for (const [model, tokens] of byModel) {
    rows.push({ model, tokens, costUsd: costForTokens(model, tokens) })
  }
  return rows.sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens))
}

export type UsageSample = { ts: number; tokens: number }

function floorToHour(ts: number): number {
  return ts - (ts % 3_600_000)
}

/**
 * Claude bills against a rolling five-hour block. It records no block state on
 * disk, so reconstruct it the way the CLI does: a block opens on the hour of
 * the first message and stays open for five hours, and a five-hour gap in
 * activity opens the next one.
 */
export function currentSessionWindow(samples: UsageSample[], now: number): UsageWindow {
  const span = SESSION_WINDOW_MINUTES * 60_000
  const sorted = [...samples].sort((a, b) => a.ts - b.ts)

  let start: number | null = null
  let last = 0
  let tokens = 0
  for (const s of sorted) {
    const stale = start === null || s.ts - start >= span || s.ts - last >= span
    if (stale) {
      start = floorToHour(s.ts)
      tokens = 0
    }
    tokens += s.tokens
    last = s.ts
  }

  const active = start !== null && now - start < span
  return withBurn(
    {
      id: 'session',
      label: '5-hour block',
      windowMinutes: SESSION_WINDOW_MINUTES,
      tokens: active ? tokens : 0,
      usedPercent: null,
      startedAt: active ? start : null,
      resetsAt: active ? start! + span : null,
      reported: false,
      tokensPerHour: null,
      projectedTokens: null,
      projectedPercent: null,
    },
    now,
  )
}

/** Pace so far, extended to the end of the window. Too-short a sample says nothing. */
const MIN_BURN_ELAPSED_MS = 5 * 60_000

export function withBurn(w: UsageWindow, now: number): UsageWindow {
  const span = w.windowMinutes * 60_000
  const start = w.startedAt ?? (w.resetsAt !== null && span > 0 ? w.resetsAt - span : null)
  if (start === null || span <= 0) return w

  const elapsed = now - start
  if (elapsed < MIN_BURN_ELAPSED_MS || elapsed > span) return w
  const share = elapsed / span

  return {
    ...w,
    tokensPerHour: w.tokens > 0 ? w.tokens / (elapsed / 3_600_000) : w.tokensPerHour,
    projectedTokens: w.tokens > 0 ? Math.round(w.tokens / share) : w.projectedTokens,
    projectedPercent:
      w.usedPercent !== null && w.usedPercent > 0
        ? Math.min(999, w.usedPercent / share)
        : w.projectedPercent,
  }
}

export function rollingWeekWindow(samples: UsageSample[], now: number): UsageWindow {
  const since = now - WEEKLY_WINDOW_MINUTES * 60_000
  let tokens = 0
  for (const s of samples) if (s.ts >= since) tokens += s.tokens
  return {
    id: 'weekly',
    label: 'Last 7 days',
    windowMinutes: WEEKLY_WINDOW_MINUTES,
    tokens,
    usedPercent: null,
    startedAt: since,
    resetsAt: null,
    reported: false,
    tokensPerHour: null,
    projectedTokens: null,
    projectedPercent: null,
  }
}

/**
 * Which Open Run project a CLI folder belongs to. Worktree paths live under
 * their own root, so the longest matching path wins over the shortest.
 */
export function matchProject(
  cwd: string,
  entries: Array<{ id: string; name: string; path: string }>,
): { id: string; name: string } | null {
  const target = cwd.replace(/\/+$/, '')
  let best: { id: string; name: string; path: string } | null = null
  for (const entry of entries) {
    const root = entry.path.replace(/\/+$/, '')
    if (!root) continue
    if (target !== root && !target.startsWith(`${root}/`)) continue
    if (!best || root.length > best.path.length) best = entry
  }
  return best ? { id: best.id, name: best.name } : null
}

export function pathTail(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || path
}

export function formatRate(tokensPerHour: number | null): string {
  if (!tokensPerHour || tokensPerHour <= 0) return ''
  return `${formatTokens(tokensPerHour)}/h`
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1_000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

export function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1_000) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

export function formatResetIn(resetsAt: number | null, now: number): string {
  if (!resetsAt) return ''
  const ms = resetsAt - now
  if (ms <= 0) return 'resets now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `resets in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `resets in ${hours}h ${mins % 60}m`
  const days = Math.floor(hours / 24)
  return `resets in ${days}d ${hours % 24}h`
}

export function usageStatusMessage(usage: RuntimeUsage): string {
  if (usage.status === 'not-installed') return `${usage.bin} is not on PATH.`
  if (usage.status === 'unsupported') return 'This CLI keeps no usage record Open Run can read.'
  if (usage.status === 'empty') return 'No local history yet.'
  // Readable history, nothing inside the selected range.
  if (usage.totalTokens === 0 && usage.sessions === 0) return 'Nothing in this range.'
  if (usage.status === 'no-token-data') return 'This CLI records sessions but no token counts.'
  return usage.note
}
