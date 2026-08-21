/**
 * Read each CLI's on-disk history and total it up — the closest thing Open Run
 * has to running `/usage` inside every agent.
 *
 * Isolated here for the same reason as `nativeSessions.ts`: these formats are
 * undocumented and can break on a CLI upgrade. Two properties keep this cheap
 * enough to run from a page load. Files are totalled once and cached by
 * (size, mtime, parser version), so a rescan touches only what changed; and
 * Codex rollouts — which run to tens of megabytes and carry a *cumulative*
 * total on their last `token_count` event — are read from the tail rather than
 * parsed whole.
 *
 * The cache holds per-file totals bucketed by day and model, never a
 * pre-summed answer, so changing the range or the price table re-aggregates
 * without re-reading a byte.
 */
import Database from 'better-sqlite3'
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  DAILY_HISTORY_DAYS,
  SAMPLE_RETENTION_DAYS,
  addTokens,
  costForTokens,
  currentSessionWindow,
  emptyTokens,
  matchProject,
  modelRows,
  pathTail,
  rangeCutoff,
  rollingWeekWindow,
  totalTokens,
  withBurn,
  type RuntimeUsage,
  type UsageDay,
  type UsagePressure,
  type UsageProject,
  type UsageRange,
  type UsageReport,
  type UsageSample,
  type UsageStatus,
  type UsageTokens,
  type UsageWindow,
} from '../lib/usage.ts'
import { modelKindForBin } from '../lib/models.ts'
import { isAcpTransport } from '../lib/acpTransport.ts'
import { readClaudeLimits } from './claudeLimits.ts'
import { getDb } from './db.ts'

/** Bump when a parser changes so cached per-file totals re-derive. */
const PARSER_VERSION = 2

const CODEX_TAIL_BYTES = 512 * 1024
const CODEX_HEAD_BYTES = 16 * 1024
const TOP_PROJECTS = 8

/** [input, output, cacheRead, cacheWrite5m, cacheWrite1h] */
type Tuple5 = [number, number, number, number, number]

type FileStats = {
  /** The folder the CLI ran in — one per history file for every CLI we read. */
  cwd: string
  sessions: number
  messages: number
  lastTs: number
  /** YYYY-MM-DD → model → tokens. Costing happens at aggregate time. */
  daily: Record<string, Record<string, Tuple5>>
  samples: [number, number][]
  /** Only Codex reports these; the newest file wins. */
  windows?: UsageWindow[]
  plan?: string
}

type Scan = {
  status: UsageStatus
  source: string
  note: string
  files: FileStats[]
  windows?: UsageWindow[]
  plan?: string
}

function emptyStats(cwd = ''): FileStats {
  return { cwd, sessions: 0, messages: 0, lastTs: 0, daily: {}, samples: [] }
}

// --- Home directories ------------------------------------------------------

function homeDir(): string {
  return homedir()
}

function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim()
  return override ? resolve(override) : join(homeDir(), '.claude')
}

function codexHome(): string {
  const override = process.env.CODEX_HOME?.trim()
  return override ? resolve(override) : join(homeDir(), '.codex')
}

function grokHome(): string {
  const override = process.env.GROK_HOME?.trim()
  return override ? resolve(override) : join(homeDir(), '.grok')
}

function geminiHome(): string {
  const override = process.env.GEMINI_HOME?.trim()
  return override ? resolve(override) : join(homeDir(), '.gemini')
}

function agyRoot(): string {
  const override = process.env.ANTIGRAVITY_CLI_ROOT?.trim()
  return override ? resolve(override) : join(geminiHome(), 'antigravity-cli')
}

function tilde(path: string): string {
  const home = homeDir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

// --- Filesystem helpers ----------------------------------------------------

function walkFiles(dir: string, suffix: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return out
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, suffix, out, depth + 1)
    else if (entry.name.endsWith(suffix)) out.push(full)
  }
  return out
}

function readSlice(file: string, offset: number, maxBytes: number): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, offset)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function openReadonly(path: string): Database.Database | null {
  if (!existsSync(path)) return null
  try {
    return new Database(path, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function record(stats: FileStats, model: string, ts: number, tokens: UsageTokens) {
  const key = model || 'unknown'
  const date = dayKey(ts)
  stats.daily[date] ??= {}
  const day = stats.daily[date]
  day[key] ??= [0, 0, 0, 0, 0]
  const slot = day[key]
  slot[0] += tokens.input
  slot[1] += tokens.output
  slot[2] += tokens.cacheRead
  slot[3] += tokens.cacheWrite5m
  slot[4] += tokens.cacheWrite1h

  stats.messages += 1
  stats.samples.push([ts, totalTokens(tokens)])
  if (ts > stats.lastTs) stats.lastTs = ts
}

// --- Per-CLI file parsers --------------------------------------------------

function parseClaudeFile(file: string): FileStats {
  const stats = emptyStats()
  stats.sessions = 1
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return stats
  }

  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    if (!stats.cwd && line.includes('"cwd"')) {
      stats.cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(line)?.[1]?.replace(/\\\//g, '/') ?? ''
    }
    if (!line.includes('"usage"')) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (obj.type !== 'assistant') continue
    const message = obj.message as Record<string, unknown> | undefined
    const usage = message?.usage as Record<string, unknown> | undefined
    if (!usage) continue

    // Claude re-writes an assistant row when a chat is resumed or forked;
    // the API message id is what makes those the same billed request.
    const id = typeof message?.id === 'string' ? message.id : ''
    if (id) {
      if (seen.has(id)) continue
      seen.add(id)
    }

    const ts = Date.parse(String(obj.timestamp ?? ''))
    if (!Number.isFinite(ts)) continue
    const model = String(message?.model ?? '').trim()
    if (!model || model === '<synthetic>') continue

    const creation = usage.cache_creation as Record<string, unknown> | undefined
    const writeTotal = num(usage.cache_creation_input_tokens)
    record(stats, model, ts, {
      input: num(usage.input_tokens),
      output: num(usage.output_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
      cacheWrite5m: creation ? num(creation.ephemeral_5m_input_tokens) : writeTotal,
      cacheWrite1h: creation ? num(creation.ephemeral_1h_input_tokens) : 0,
    })
  }
  return stats
}

function parseCodexFile(file: string, size: number): FileStats {
  const stats = emptyStats()
  stats.sessions = 1

  let model = ''
  try {
    const head = readSlice(file, 0, Math.min(CODEX_HEAD_BYTES, size))
    model = /"model":"([^"]+)"/.exec(head)?.[1] ?? ''
    stats.cwd = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(head)?.[1]?.replace(/\\\//g, '/') ?? ''
  } catch {
    return stats
  }

  const offset = Math.max(0, size - CODEX_TAIL_BYTES)
  let tail: string
  try {
    tail = readSlice(file, offset, Math.min(CODEX_TAIL_BYTES, size))
  } catch {
    return stats
  }

  // The last `token_count` carries the session's cumulative totals and the
  // rate-limit windows as of the final turn — no need to sum the events.
  let last: Record<string, unknown> | null = null
  let lastTs = 0
  for (const line of tail.split('\n')) {
    if (!line.includes('"token_count"')) continue
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const payload = obj.payload as Record<string, unknown> | undefined
      if (payload?.type !== 'token_count') continue
      last = payload
      lastTs = Date.parse(String(obj.timestamp ?? '')) || lastTs
    } catch {}
  }
  if (!last) return stats

  const info = last.info as Record<string, unknown> | undefined
  const total = info?.total_token_usage as Record<string, unknown> | undefined
  if (total && lastTs) {
    const cached = num(total.cached_input_tokens)
    record(stats, model || 'unknown', lastTs, {
      // `input_tokens` here is the full input including the cached part.
      input: Math.max(0, num(total.input_tokens) - cached),
      output: num(total.output_tokens),
      cacheRead: cached,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    })
  }

  const windows = codexWindows(last)
  if (windows.length) stats.windows = windows
  const limits = last.rate_limits as Record<string, unknown> | undefined
  if (typeof limits?.plan_type === 'string') stats.plan = limits.plan_type
  return stats
}

function codexWindows(payload: Record<string, unknown>): UsageWindow[] {
  const limits = payload.rate_limits as Record<string, unknown> | undefined
  if (!limits) return []
  const out: UsageWindow[] = []
  const primary = codexWindow(limits.primary, 'session', '5-hour limit')
  const secondary = codexWindow(limits.secondary, 'weekly', 'Weekly limit')
  if (primary) out.push(primary)
  if (secondary) out.push(secondary)
  return out
}

function codexWindow(raw: unknown, id: UsageWindow['id'], label: string): UsageWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const percent = typeof w.used_percent === 'number' ? w.used_percent : null
  if (percent === null) return null
  return {
    id,
    label,
    windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : 0,
    tokens: 0,
    usedPercent: percent,
    startedAt: null,
    resetsAt: typeof w.resets_at === 'number' ? w.resets_at * 1000 : null,
    reported: true,
    tokensPerHour: null,
    projectedTokens: null,
    projectedPercent: null,
  }
}

// --- Per-CLI scanners ------------------------------------------------------

function scanClaude(): Scan {
  const root = join(claudeHome(), 'projects')
  const source = tilde(root)
  if (!existsSync(root)) {
    return { status: 'empty', source, note: 'No Claude history in this home directory.', files: [] }
  }
  const files = mergeCached('claude', walkFiles(root, '.jsonl'), parseClaudeFile)
  // Claude keeps no limits on disk, so the real ones come from the account.
  // Absent (no login token, offline, first load) the windows stay derived.
  const limits = readClaudeLimits()
  return {
    status: files.some((f) => f.messages > 0) ? 'ok' : 'empty',
    source,
    note: limits
      ? 'Limits come from your Claude account. Tokens are read from message history.'
      : 'Windows are derived from message timestamps — Claude records no plan limits on disk.',
    files,
    windows: limits?.windows,
  }
}

function scanCodex(): Scan {
  const root = join(codexHome(), 'sessions')
  const source = tilde(root)
  if (!existsSync(root)) {
    return { status: 'empty', source, note: 'No Codex history in this home directory.', files: [] }
  }
  const files = mergeCached('codex', walkFiles(root, '.jsonl'), parseCodexFile)

  // Limits are a point-in-time reading, so only the newest file's copy is true.
  let newest: FileStats | null = null
  for (const file of files) {
    if (file.windows && (!newest || file.lastTs > newest.lastTs)) newest = file
  }
  return {
    status: files.some((f) => f.messages > 0) ? 'ok' : 'empty',
    source,
    note: 'Limits come from Codex itself. Tokens are per-session totals, so they land on the day a session ended.',
    files,
    windows: newest?.windows,
    plan: newest?.plan,
  }
}

function scanGrok(): Scan {
  const root = join(grokHome(), 'sessions')
  const source = tilde(root)
  if (!existsSync(root)) {
    return { status: 'empty', source, note: 'No Grok history in this home directory.', files: [] }
  }
  const files: FileStats[] = []
  for (const file of walkFiles(root, 'summary.json')) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      const info = raw.info as Record<string, unknown> | undefined
      const stats = emptyStats(String(info?.cwd ?? ''))
      stats.sessions = 1
      stats.messages = num(raw.num_chat_messages) || num(raw.num_messages)
      const ts = Date.parse(String(raw.updated_at ?? raw.created_at ?? ''))
      stats.lastTs = Number.isFinite(ts) ? ts : 0
      files.push(stats)
    } catch {}
  }
  return {
    status: files.length > 0 ? 'no-token-data' : 'empty',
    source,
    note: 'Grok stores sessions and messages but no token counts, so there is nothing to cost.',
    files,
  }
}

function scanGemini(): Scan {
  const root = join(geminiHome(), 'tmp')
  const source = tilde(root)
  if (!existsSync(root)) {
    return { status: 'empty', source, note: 'No Gemini history in this home directory.', files: [] }
  }
  const files: FileStats[] = []
  for (const file of walkFiles(root, 'logs.json')) {
    try {
      const rows = JSON.parse(readFileSync(file, 'utf8'))
      if (!Array.isArray(rows) || rows.length === 0) continue
      const sessions = new Set<string>()
      const stats = emptyStats()
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const entry = row as Record<string, unknown>
        if (typeof entry.sessionId === 'string') sessions.add(entry.sessionId)
        stats.messages += 1
        const ts = Date.parse(String(entry.timestamp ?? ''))
        if (Number.isFinite(ts) && ts > stats.lastTs) stats.lastTs = ts
      }
      stats.sessions = sessions.size
      files.push(stats)
    } catch {}
  }
  return {
    status: files.length > 0 ? 'no-token-data' : 'empty',
    source,
    note: 'Gemini logs prompts only — no token counts, over either transport.',
    files,
  }
}

function scanAntigravity(): Scan {
  const root = agyRoot()
  const source = tilde(root)
  const db = openReadonly(join(root, 'conversation_summaries.db'))
  if (!db) {
    return {
      status: 'empty',
      source,
      note: 'No Antigravity history in this home directory.',
      files: [],
    }
  }
  const files: FileStats[] = []
  try {
    const rows = db
      .prepare('SELECT step_count, last_modified_time, workspace_uris FROM conversation_summaries')
      .all() as Array<{ step_count?: number; last_modified_time?: string; workspace_uris?: string }>
    for (const row of rows) {
      const stats = emptyStats(firstWorkspaceUri(row.workspace_uris))
      stats.sessions = 1
      stats.messages = num(row.step_count)
      const ts = Date.parse(String(row.last_modified_time ?? '').replace(' ', 'T'))
      stats.lastTs = Number.isFinite(ts) ? ts : 0
      files.push(stats)
    }
  } catch {
    // Schema drifted on a CLI upgrade — report nothing rather than a wrong total.
  } finally {
    db.close()
  }
  return {
    status: files.length > 0 ? 'no-token-data' : 'empty',
    source,
    note: 'Antigravity records conversations and step counts but no token usage.',
    files,
  }
}

/** Highest-sorting subdirectory, or '' when there is none. */
function newestChild(dir: string): string {
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    const last = names[names.length - 1]
    return last ? join(dir, last) : ''
  } catch {
    return ''
  }
}

function firstWorkspaceUri(raw: string | undefined): string {
  if (!raw) return ''
  try {
    const list = JSON.parse(raw)
    const first = Array.isArray(list) ? String(list[0] ?? '') : ''
    return first.startsWith('file://') ? decodeURIComponent(first.slice('file://'.length)) : first
  } catch {
    return ''
  }
}

function scanUnsupported(bin: string): Scan {
  return {
    status: 'unsupported',
    source: '',
    note: `${bin} keeps no usage record Open Run can read.`,
    files: [],
  }
}

// --- Cache -----------------------------------------------------------------

type CacheRow = { size: number; mtimeMs: number; version: number; stats: string }

function mergeCached(
  kind: string,
  paths: string[],
  parse: (file: string, size: number) => FileStats,
): FileStats[] {
  const db = getDb()
  const read = db.prepare(
    'SELECT size, mtimeMs, version, stats FROM usage_file_cache WHERE path = ?',
  )
  const write = db.prepare(
    `INSERT INTO usage_file_cache (path, kind, size, mtimeMs, version, stats, updatedAt)
     VALUES (@path, @kind, @size, @mtimeMs, @version, @stats, @updatedAt)
     ON CONFLICT(path) DO UPDATE SET
       size = excluded.size, mtimeMs = excluded.mtimeMs, version = excluded.version,
       stats = excluded.stats, updatedAt = excluded.updatedAt`,
  )

  const sampleFloor = Date.now() - SAMPLE_RETENTION_DAYS * 86_400_000
  const out: FileStats[] = []

  for (const file of paths) {
    let size = 0
    let mtimeMs = 0
    try {
      const st = statSync(file)
      size = st.size
      mtimeMs = Math.round(st.mtimeMs)
    } catch {
      continue
    }

    let stats: FileStats | null = null
    const cached = read.get(file) as CacheRow | undefined
    if (
      cached &&
      cached.size === size &&
      cached.mtimeMs === mtimeMs &&
      cached.version === PARSER_VERSION
    ) {
      try {
        stats = JSON.parse(cached.stats) as FileStats
      } catch {
        stats = null
      }
    }
    if (!stats) {
      stats = parse(file, size)
      // Old files never re-enter the sample window; drop their samples so the
      // cache does not carry a copy of every message forever.
      stats.samples = stats.samples.filter(([ts]) => ts >= sampleFloor)
      write.run({
        path: file,
        kind,
        size,
        mtimeMs,
        version: PARSER_VERSION,
        stats: JSON.stringify(stats),
        updatedAt: Date.now(),
      })
    }
    out.push(stats)
  }
  return out
}

// --- Aggregation -----------------------------------------------------------

export type UsageRuntimeInput = {
  id: string
  label: string
  bin: string
  transport?: string | null
  installed: boolean
}

export type UsageProjectInput = { id: string; name: string; path: string }

const SCANNERS: Record<string, () => Scan> = {
  claude: scanClaude,
  codex: scanCodex,
  grok: scanGrok,
  gemini: scanGemini,
  antigravity: scanAntigravity,
}

type ProjectAccumulator = {
  path: string
  projectId: string
  label: string
  tokens: number
  costUsd: number
  unpriced: number
  sessions: number
}

export function collectUsage(input: {
  runtimes: UsageRuntimeInput[]
  projects: UsageProjectInput[]
  range: UsageRange
  runCounts: Record<string, number>
}): UsageReport {
  const startedAt = Date.now()
  const cutoff = rangeCutoff(input.range, startedAt)
  const scans = new Map<string, Scan>()
  const sharedBy = new Map<string, string[]>()
  const globalProjects = new Map<string, ProjectAccumulator>()

  for (const runtime of input.runtimes) {
    const kind = modelKindForBin(runtime.bin)
    sharedBy.set(kind, [...(sharedBy.get(kind) ?? []), runtime.label])
  }

  const countedKinds = new Set<string>()
  const rows: RuntimeUsage[] = input.runtimes.map((runtime) => {
    const kind = modelKindForBin(runtime.bin)
    let scan = scans.get(kind)
    if (!scan) {
      const scanner = SCANNERS[kind]
      scan = scanner ? scanner() : scanUnsupported(runtime.bin)
      scans.set(kind, scan)
    }

    // Two runtimes on one binary (Gemini CLI and Gemini ACP) read the same
    // history — let only the first fold it into the cross-CLI project totals.
    const firstOfKind = !countedKinds.has(kind)
    countedKinds.add(kind)

    const byModel = new Map<string, UsageTokens>()
    const byDay = new Map<string, { tokens: number; cost: number; unpriced: number }>()
    const localProjects = new Map<string, ProjectAccumulator>()
    const samples: UsageSample[] = []
    let sessions = 0
    let messages = 0
    let lastUsedAt = 0

    for (const file of scan.files) {
      let fileTokens = 0
      let fileCost = 0
      let fileUnpriced = 0
      let touched = scan.status === 'no-token-data' && withinRange(file.lastTs, cutoff)

      for (const [date, models] of Object.entries(file.daily)) {
        const dayTs = Date.parse(`${date}T00:00:00.000Z`)
        if (cutoff > 0 && dayTs + 86_399_999 < cutoff) continue
        touched = true
        const day = byDay.get(date) ?? { tokens: 0, cost: 0, unpriced: 0 }
        for (const [model, t] of Object.entries(models)) {
          const tokens: UsageTokens = {
            input: t[0] ?? 0,
            output: t[1] ?? 0,
            cacheRead: t[2] ?? 0,
            cacheWrite5m: t[3] ?? 0,
            cacheWrite1h: t[4] ?? 0,
          }
          const total = totalTokens(tokens)
          const cost = costForTokens(model, tokens)
          addTokens(byModel.get(model) ?? setModel(byModel, model), tokens)
          day.tokens += total
          day.cost += cost ?? 0
          day.unpriced += cost === null ? total : 0
          fileTokens += total
          fileCost += cost ?? 0
          fileUnpriced += cost === null ? total : 0
        }
        byDay.set(date, day)
      }

      if (!touched) continue
      sessions += file.sessions
      messages += file.messages
      if (file.lastTs > lastUsedAt) lastUsedAt = file.lastTs
      for (const [ts, n] of file.samples) samples.push({ ts, tokens: n })

      if (file.cwd) {
        foldProject(localProjects, input.projects, file, fileTokens, fileCost, fileUnpriced)
        if (firstOfKind) {
          foldProject(globalProjects, input.projects, file, fileTokens, fileCost, fileUnpriced)
        }
      }
    }

    const tokens = emptyTokens()
    for (const t of byModel.values()) addTokens(tokens, t)

    let costUsd = 0
    let unpriced = 0
    const daily: UsageDay[] = [...byDay.entries()]
      .map(([date, d]) => {
        costUsd += d.cost
        unpriced += d.unpriced
        return { date, tokens: d.tokens, costUsd: d.unpriced > 0 ? null : d.cost }
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, DAILY_HISTORY_DAYS)
      .reverse()

    const reported = scan.windows?.map((w) => withBurn(w, startedAt))
    const derived =
      scan.status === 'ok'
        ? [currentSessionWindow(samples, startedAt), rollingWeekWindow(samples, startedAt)]
        : []

    const peers = (sharedBy.get(kind) ?? []).filter((label) => label !== runtime.label)
    const shared = peers.length ? ` Shared with ${peers.join(', ')}.` : ''

    return {
      runtimeId: runtime.id,
      label: runtime.label,
      bin: runtime.bin,
      kind,
      transport: isAcpTransport(runtime.transport) ? 'acp' : 'cli',
      installed: runtime.installed,
      status: runtime.installed ? scan.status : 'not-installed',
      source: scan.source,
      note: `${scan.note}${shared}`.trim(),
      tokens,
      totalTokens: totalTokens(tokens),
      costUsd: unpriced > 0 && costUsd === 0 ? null : costUsd,
      unpricedTokens: unpriced,
      models: modelRows(byModel),
      daily,
      windows: reported?.length ? reported : derived,
      projects: rankProjects(localProjects),
      sessions,
      messages,
      lastUsedAt: lastUsedAt || null,
      plan: scan.plan ?? '',
      openRunRuns: input.runCounts[runtime.id] ?? 0,
    }
  })

  const counted = new Set<string>()
  const totals = { tokens: 0, costUsd: 0, unpricedTokens: 0, sessions: 0, openRunRuns: 0 }
  for (const row of rows) {
    totals.openRunRuns += row.openRunRuns
    if (counted.has(row.kind)) continue
    counted.add(row.kind)
    totals.tokens += row.totalTokens
    totals.costUsd += row.costUsd ?? 0
    totals.unpricedTokens += row.unpricedTokens
    totals.sessions += row.sessions
  }

  return {
    generatedAt: startedAt,
    scanMs: Date.now() - startedAt,
    range: input.range,
    runtimes: rows,
    projects: rankProjects(globalProjects),
    totals,
  }
}

function setModel(map: Map<string, UsageTokens>, model: string): UsageTokens {
  const fresh = emptyTokens()
  map.set(model, fresh)
  return fresh
}

function withinRange(ts: number, cutoff: number): boolean {
  return cutoff === 0 ? ts > 0 : ts >= cutoff
}

function foldProject(
  into: Map<string, ProjectAccumulator>,
  projects: UsageProjectInput[],
  file: FileStats,
  tokens: number,
  cost: number,
  unpriced: number,
) {
  const matched = matchProject(file.cwd, projects)
  const key = matched?.id || file.cwd
  const acc =
    into.get(key) ??
    ({
      path: file.cwd,
      projectId: matched?.id ?? '',
      label: matched?.name ?? pathTail(file.cwd),
      tokens: 0,
      costUsd: 0,
      unpriced: 0,
      sessions: 0,
    } satisfies ProjectAccumulator)
  acc.tokens += tokens
  acc.costUsd += cost
  acc.unpriced += unpriced
  acc.sessions += file.sessions
  into.set(key, acc)
}

function rankProjects(map: Map<string, ProjectAccumulator>): UsageProject[] {
  return [...map.values()]
    .sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions)
    .slice(0, TOP_PROJECTS)
    .map((p) => ({
      path: p.path,
      label: p.label,
      projectId: p.projectId,
      tokens: p.tokens,
      costUsd: p.unpriced > 0 && p.costUsd === 0 ? null : p.costUsd,
      sessions: p.sessions,
    }))
}

/**
 * The tightest limit any CLI reports about itself, for the account-menu badge.
 * Codex costs one file read — the newest rollout's tail — and Claude costs a
 * cached lookup, so this is safe to poll.
 */
export function readUsagePressure(): UsagePressure {
  const idle: UsagePressure = { usedPercent: null, label: '', runtime: '', resetsAt: null }
  const reported: Array<{ window: UsageWindow; runtime: string }> = [
    ...(readClaudeLimits()?.windows ?? []).map((window) => ({ window, runtime: 'Claude' })),
    ...codexReportedWindows().map((window) => ({ window, runtime: 'Codex' })),
  ]

  const worst = reported
    .filter((r) => r.window.usedPercent !== null)
    .sort((a, b) => (b.window.usedPercent ?? 0) - (a.window.usedPercent ?? 0))[0]
  if (!worst) return idle
  return {
    usedPercent: worst.window.usedPercent,
    label: worst.window.label,
    runtime: worst.runtime,
    resetsAt: worst.window.resetsAt,
  }
}

/** Codex's own limit reading, from the newest rollout that carries one. */
function codexReportedWindows(): UsageWindow[] {
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return []

  // Rollouts live under YYYY/MM/DD, so descending into the newest name at each
  // level finds today's file without stat-ing the whole archive.
  let day = root
  for (let depth = 0; depth < 3; depth += 1) {
    const next = newestChild(day)
    if (!next) break
    day = next
  }

  let newest = ''
  let newestMtime = 0
  let newestSize = 0
  for (const file of walkFiles(day, '.jsonl')) {
    try {
      const st = statSync(file)
      if (st.mtimeMs > newestMtime) {
        newestMtime = st.mtimeMs
        newest = file
        newestSize = st.size
      }
    } catch {}
  }
  if (!newest) return []

  let tail: string
  try {
    const offset = Math.max(0, newestSize - CODEX_TAIL_BYTES)
    tail = readSlice(newest, offset, Math.min(CODEX_TAIL_BYTES, newestSize))
  } catch {
    return []
  }

  let windows: UsageWindow[] = []
  for (const line of tail.split('\n')) {
    if (!line.includes('"rate_limits"')) continue
    try {
      const payload = (JSON.parse(line) as Record<string, unknown>).payload as
        | Record<string, unknown>
        | undefined
      if (payload?.type !== 'token_count') continue
      const parsed = codexWindows(payload)
      if (parsed.length) windows = parsed
    } catch {}
  }
  return windows
}
