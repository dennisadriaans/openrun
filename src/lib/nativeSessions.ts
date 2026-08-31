/**
 * Native CLI session listing — parse-only, browser-safe.
 *
 * These helpers turn each CLI's on-disk index (or a JSONL *prefix*) into picker
 * rows: id, title, timestamps. Full transcript parsing lives separately in
 * `nativeTranscript.ts`; the server module locates both stores for the cwd.
 */
import { isAcpTransport } from './acpTransport.ts'
import { modelKindForBin, type RuntimeModelKind } from './models.ts'

export const NATIVE_RESUME_DEFAULT_PROMPT = 'continue'
export const NATIVE_SESSION_PAGE_SIZE = 5

export const NATIVE_RESUME_KINDS = ['claude', 'codex', 'grok', 'antigravity'] as const
export type NativeSessionKind = (typeof NATIVE_RESUME_KINDS)[number]

export type NativeSession = {
  sessionId: string
  title: string
  modifiedAt: number
  createdAt?: number
  messageCount?: number
  kind: NativeSessionKind
  /** Present on scan rows so the server can keep workspace-scoped lists. */
  cwd?: string
}

export type NativeSessionGroup = {
  kind: NativeSessionKind
  label: string
  bin: string
  runtimeId: string
  sessions: NativeSession[]
  hasMore: boolean
}

const TITLE_MAX = 100

export function isNativeResumeKind(value: string): value is NativeSessionKind {
  return (NATIVE_RESUME_KINDS as readonly string[]).includes(value)
}

export function nativeSessionKindLabel(kind: NativeSessionKind): string {
  if (kind === 'claude') return 'Claude'
  if (kind === 'codex') return 'Codex'
  if (kind === 'grok') return 'Grok'
  return 'Antigravity'
}

export function nativeResumeKindFor(input: {
  bin?: string
  transport?: string | null
}): NativeSessionKind | null {
  if (!input.bin?.trim() || isAcpTransport(input.transport)) return null
  const kind = modelKindForBin(input.bin) as RuntimeModelKind
  return isNativeResumeKind(kind) ? kind : null
}

export function normalizeNativeCwd(cwd: string): string {
  return cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export function nativeCwdsEqual(a: string, b: string): boolean {
  return normalizeNativeCwd(a) === normalizeNativeCwd(b)
}

export function paginateNativeSessions<T>(
  items: T[],
  offset = 0,
  limit = NATIVE_SESSION_PAGE_SIZE,
): { items: T[]; hasMore: boolean } {
  const start = Math.max(0, offset)
  const size = limit > 0 ? limit : NATIVE_SESSION_PAGE_SIZE
  const slice = items.slice(start, start + size)
  return { items: slice, hasMore: start + slice.length < items.length }
}

/** Claude stores projects as the absolute cwd with `/` replaced by `-`. */
export function encodeClaudeProjectDir(cwd: string): string {
  const normalized = normalizeNativeCwd(cwd)
  if (!normalized) return ''
  return normalized.replace(/\//g, '-')
}

export function claudeProjectDir(home: string, cwd: string): string {
  const encoded = encodeClaudeProjectDir(cwd)
  if (!encoded) return ''
  const root = normalizeNativeCwd(home)
  return `${root}/.claude/projects/${encoded}`
}

/** Grok groups sessions by URL-encoded cwd under `~/.grok/sessions/`. */
export function encodeGrokProjectDir(cwd: string): string {
  const normalized = normalizeNativeCwd(cwd)
  if (!normalized) return ''
  return encodeURIComponent(normalized)
}

export function grokProjectDir(home: string, cwd: string): string {
  const encoded = encodeGrokProjectDir(cwd)
  if (!encoded) return ''
  return `${normalizeNativeCwd(home)}/sessions/${encoded}`
}

export function agyCliRoot(home: string): string {
  return `${normalizeNativeCwd(home)}/.gemini/antigravity-cli`
}

export function missingNativeSessionMessage(kind?: NativeSessionKind): string {
  const who = kind ? nativeSessionKindLabel(kind) : 'Native'
  return `${who} chat was not found in this workspace folder. Native resume lists chats started in the same folder as this workspace.`
}

export function nativeResumeNotSupportedMessage(): string {
  return 'Resuming a native chat needs a CLI runtime (not ACP) that supports it. Pick Claude, Codex, Grok, or Antigravity, or start a new conversation.'
}

export function resumedNativeChatStub(kind: NativeSessionKind, label: string): string {
  const who = nativeSessionKindLabel(kind)
  const title = label.trim()
  return title ? `Resumed ${who} chat · ${title}` : `Resumed ${who} chat`
}

export function resumedClaudeChatStub(label: string): string {
  return resumedNativeChatStub('claude', label)
}

export function truncateSessionTitle(text: string, max = TITLE_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

export function sqliteTimestampMs(seconds: number | undefined, millis: number | undefined): number {
  if (typeof millis === 'number' && Number.isFinite(millis) && millis > 0) {
    return millis > 1e12 ? millis : millis * 1000
  }
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return seconds > 1e12 ? seconds : seconds * 1000
  }
  return 0
}

function jsonlCompleteLines(prefix: string): string[] {
  const lines = prefix.split('\n')
  if (lines.length > 0 && !prefix.endsWith('\n')) {
    try {
      JSON.parse(lines[lines.length - 1]!)
    } catch {
      lines.pop()
    }
  }
  return lines
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key]
  return typeof value === 'string' ? value : ''
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function parseIsoMs(value: string): number | undefined {
  if (!value.trim()) return undefined
  const ms = Date.parse(value)
  if (Number.isFinite(ms)) return ms
  const alt = Date.parse(value.trim().replace(' ', 'T'))
  return Number.isFinite(alt) ? alt : undefined
}

function titleFrom(summary: string, firstPrompt: string, sessionId: string): string {
  const summaryTitle = truncateSessionTitle(summary)
  if (summaryTitle) return summaryTitle
  const promptTitle = truncateSessionTitle(firstPrompt)
  if (promptTitle) return promptTitle
  return sessionId.slice(0, 8)
}

/**
 * `sessions-index.json` when Claude wrote one. Sidechain rows are skipped.
 */
export function parseClaudeSessionsIndex(json: unknown): NativeSession[] {
  const root = asRecord(json)
  if (!root) return []
  const entries = root.entries
  if (!Array.isArray(entries)) return []

  const out: NativeSession[] = []
  for (const raw of entries) {
    const entry = asRecord(raw)
    if (!entry) continue
    if (entry.isSidechain === true) continue
    const sessionId = stringField(entry, 'sessionId').trim()
    if (!sessionId) continue
    const modified =
      parseIsoMs(stringField(entry, 'modified')) ?? numberField(entry, 'fileMtime') ?? 0
    const created = parseIsoMs(stringField(entry, 'created'))
    const messageCount = numberField(entry, 'messageCount')
    out.push({
      sessionId,
      title: titleFrom(stringField(entry, 'summary'), stringField(entry, 'firstPrompt'), sessionId),
      modifiedAt: modified,
      createdAt: created,
      messageCount,
      kind: 'claude',
    })
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Plain text out of an Anthropic user message (string or content blocks). */
export function userTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const rec = asRecord(item)
    if (!rec) continue
    if (rec.type === 'text' && typeof rec.text === 'string') parts.push(rec.text)
  }
  return parts.join('\n')
}

/** Slash-command echoes and IDE chatter that the CLI stores but never showed. */
export function isSkippableUserText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<local-command')) return true
  if (trimmed.startsWith('<ide_opened_file>') || trimmed.startsWith('<ide_selection>')) {
    return trimmed.length < 80
  }
  return false
}

/**
 * Pull picker metadata from a JSONL *prefix* (first N lines / bytes).
 * Incomplete last line is ignored. Sidechain-only prefixes are skipped.
 */
export function parseClaudeJsonlPrefix(
  prefix: string,
  input: { sessionIdFromFilename?: string; fileMtime: number },
): NativeSession | null {
  const lines = jsonlCompleteLines(prefix)

  let sessionId = (input.sessionIdFromFilename ?? '').trim()
  let firstPrompt = ''
  let summary = ''
  let createdAt: number | undefined
  let sawRootSidechain = false
  let sawNonSidechain = false

  for (const line of lines) {
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

    if (!sessionId) {
      sessionId = stringField(rec, 'sessionId').trim() || stringField(rec, 'session_id').trim()
    }

    const timestamp = parseIsoMs(stringField(rec, 'timestamp'))
    if (timestamp !== undefined && createdAt === undefined) createdAt = timestamp

    if (rec.type === 'ai-title') {
      const title = stringField(rec, 'aiTitle').trim()
      if (title) summary = title
    }
    if (rec.type === 'last-prompt') {
      const last = stringField(rec, 'lastPrompt').trim()
      if (last && !firstPrompt) firstPrompt = last
    }

    if (rec.isSidechain === true && rec.parentUuid == null) sawRootSidechain = true
    if (rec.isSidechain === false) sawNonSidechain = true

    if (rec.type === 'user' && rec.isMeta !== true && !firstPrompt) {
      const message = asRecord(rec.message)
      const text = userTextFromContent(message?.content ?? rec.content)
      if (!isSkippableUserText(text)) firstPrompt = text
    }
  }

  if (!sessionId) return null
  if (sawRootSidechain && !sawNonSidechain) return null

  return {
    sessionId,
    title: titleFrom(summary, firstPrompt, sessionId),
    modifiedAt: input.fileMtime,
    createdAt,
    kind: 'claude',
  }
}

const CODEX_SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export function codexSessionIdFromFilename(name: string): string {
  const base = name.replace(/\.jsonl(\.zst)?$/i, '')
  const match = base.match(CODEX_SESSION_ID)
  return match?.[1] ?? ''
}

function codexUserText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    const rec = asRecord(item)
    if (!rec) continue
    if (typeof rec.text === 'string') parts.push(rec.text)
  }
  return parts.join('\n')
}

function isCodexEnvContext(text: string): boolean {
  return text.includes('<environment_context>') || text.includes('<permissions instructions>')
}

/**
 * Codex `state_5.sqlite` `threads` row — titles live here when the index exists.
 */
export function parseCodexThreadRow(row: unknown): NativeSession | null {
  const rec = asRecord(row)
  if (!rec) return null
  if (rec.archived === 1 || rec.archived === true) return null
  const sessionId = (stringField(rec, 'id') || stringField(rec, 'thread_id')).trim()
  if (!sessionId) return null
  const cwd = stringField(rec, 'cwd').trim()
  const modifiedAt = sqliteTimestampMs(
    numberField(rec, 'updated_at') ?? numberField(rec, 'recency_at'),
    numberField(rec, 'updated_at_ms') ?? numberField(rec, 'recency_at_ms'),
  )
  const createdAt = sqliteTimestampMs(
    numberField(rec, 'created_at'),
    numberField(rec, 'created_at_ms'),
  )
  return {
    sessionId,
    title: titleFrom(
      stringField(rec, 'title'),
      stringField(rec, 'preview') || stringField(rec, 'first_user_message'),
      sessionId,
    ),
    modifiedAt,
    createdAt: createdAt || undefined,
    kind: 'codex',
    cwd: cwd || undefined,
  }
}

/**
 * Codex rollout JSONL prefix. `session_meta` carries cwd + id; the first real
 * user_message becomes the title when the sqlite index is missing.
 */
export function parseCodexJsonlPrefix(
  prefix: string,
  input: { sessionIdFromFilename?: string; fileMtime: number },
): NativeSession | null {
  const lines = jsonlCompleteLines(prefix)

  let sessionId = (input.sessionIdFromFilename ?? '').trim()
  let cwd = ''
  let firstPrompt = ''
  let createdAt: number | undefined

  for (const line of lines) {
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
    const payload = asRecord(rec.payload) ?? rec
    const type = stringField(rec, 'type')

    if (type === 'session_meta') {
      sessionId =
        sessionId || stringField(payload, 'session_id').trim() || stringField(payload, 'id').trim()
      cwd = cwd || stringField(payload, 'cwd').trim()
      const ts = parseIsoMs(stringField(payload, 'timestamp') || stringField(rec, 'timestamp'))
      if (ts !== undefined && createdAt === undefined) createdAt = ts
    }

    if (firstPrompt) continue

    if (type === 'event_msg' && stringField(payload, 'type') === 'user_message') {
      const message = stringField(payload, 'message').trim()
      if (message && !isCodexEnvContext(message)) firstPrompt = message
      continue
    }

    if (type === 'response_item' && stringField(payload, 'role') === 'user') {
      const text = codexUserText(payload.content).trim()
      if (text && !isCodexEnvContext(text)) firstPrompt = text
    }
  }

  if (!sessionId) return null
  return {
    sessionId,
    title: titleFrom('', firstPrompt, sessionId),
    modifiedAt: input.fileMtime,
    createdAt,
    kind: 'codex',
    cwd: cwd || undefined,
  }
}

export function parseGrokSummary(json: unknown, fileMtime = 0): NativeSession | null {
  const rec = asRecord(json)
  if (!rec) return null
  const info = asRecord(rec.info)
  const sessionId = (
    (info ? stringField(info, 'id') : '') ||
    stringField(rec, 'id') ||
    stringField(rec, 'session_id')
  ).trim()
  if (!sessionId) return null
  const cwd = (info ? stringField(info, 'cwd') : '') || stringField(rec, 'cwd')
  const modified =
    parseIsoMs(stringField(rec, 'last_active_at')) ??
    parseIsoMs(stringField(rec, 'updated_at')) ??
    fileMtime
  const created = parseIsoMs(stringField(rec, 'created_at'))
  const messageCount = numberField(rec, 'num_chat_messages') ?? numberField(rec, 'num_messages')
  return {
    sessionId,
    title: titleFrom(
      stringField(rec, 'generated_title') || stringField(rec, 'session_summary'),
      '',
      sessionId,
    ),
    modifiedAt: modified,
    createdAt: created,
    messageCount,
    kind: 'grok',
    cwd: cwd.trim() || undefined,
  }
}

export function agyWorkspaceUrisMatch(uris: string, cwd: string): boolean {
  const wanted = normalizeNativeCwd(cwd)
  if (!wanted || !uris.trim()) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(uris)
  } catch {
    return normalizeNativeCwd(uris.replace(/^file:\/\/(localhost)?/i, '')) === wanted
  }
  if (!Array.isArray(parsed)) return false
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const path = normalizeNativeCwd(item.replace(/^file:\/\/(localhost)?/i, ''))
    if (path === wanted) return true
  }
  return false
}

export function parseAgySummaryRow(row: unknown): NativeSession | null {
  const rec = asRecord(row)
  if (!rec) return null
  if (numberField(rec, 'nesting_depth') && (numberField(rec, 'nesting_depth') ?? 0) > 0) {
    return null
  }
  const sessionId = stringField(rec, 'conversation_id').trim()
  if (!sessionId) return null
  const uris = stringField(rec, 'workspace_uris')
  const modified =
    parseIsoMs(stringField(rec, 'last_modified_time')) ??
    parseIsoMs(stringField(rec, 'last_user_input_time')) ??
    0
  return {
    sessionId,
    title: titleFrom(stringField(rec, 'title'), stringField(rec, 'preview'), sessionId),
    modifiedAt: modified,
    messageCount: numberField(rec, 'step_count'),
    kind: 'antigravity',
    cwd: uris,
  }
}

function isAgySlash(display: string, type: string): boolean {
  if (type === 'slash_command') return true
  return display.trim().startsWith('/')
}

export function parseAgyHistoryJsonl(text: string): NativeSession[] {
  const byId = new Map<
    string,
    { title: string; modifiedAt: number; createdAt: number; count: number; cwd: string }
  >()

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
    const sessionId = stringField(rec, 'conversationId').trim()
    if (!sessionId) continue
    const display = stringField(rec, 'display').trim()
    const type = stringField(rec, 'type')
    const cwd = stringField(rec, 'workspace').trim()
    const timestamp =
      numberField(rec, 'timestamp') ?? parseIsoMs(stringField(rec, 'timestamp')) ?? 0
    const existing = byId.get(sessionId)
    const slash = isAgySlash(display, type)
    if (!existing) {
      byId.set(sessionId, {
        title: slash ? '' : display,
        modifiedAt: timestamp,
        createdAt: timestamp,
        count: slash ? 0 : 1,
        cwd,
      })
      continue
    }
    if (!existing.title && !slash && display) existing.title = display
    if (timestamp >= existing.modifiedAt) {
      existing.modifiedAt = timestamp
      if (cwd) existing.cwd = cwd
    }
    if (timestamp && (existing.createdAt === 0 || timestamp < existing.createdAt)) {
      existing.createdAt = timestamp
    }
    if (!slash && display) existing.count += 1
  }

  const out: NativeSession[] = []
  for (const [sessionId, row] of byId) {
    out.push({
      sessionId,
      title: titleFrom(row.title, '', sessionId),
      modifiedAt: row.modifiedAt,
      createdAt: row.createdAt || undefined,
      messageCount: row.count || undefined,
      kind: 'antigravity',
      cwd: row.cwd || undefined,
    })
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/** Merge index rows with JSONL fallbacks; index wins on id collision. */
export function mergeNativeSessions(
  fromIndex: NativeSession[],
  fromJsonl: NativeSession[],
): NativeSession[] {
  const byId = new Map<string, NativeSession>()
  for (const row of fromJsonl) byId.set(row.sessionId, row)
  for (const row of fromIndex) byId.set(row.sessionId, row)
  return [...byId.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function filterSessionsForCwd(sessions: NativeSession[], cwd: string): NativeSession[] {
  const wanted = normalizeNativeCwd(cwd)
  if (!wanted) return []
  return sessions.filter((row) => {
    if (!row.cwd) return true
    if (row.kind === 'antigravity' && row.cwd.trim().startsWith('[')) {
      return agyWorkspaceUrisMatch(row.cwd, wanted)
    }
    return nativeCwdsEqual(row.cwd, wanted)
  })
}
