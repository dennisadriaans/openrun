/**
 * Read each CLI's on-disk session store for one workspace cwd.
 *
 * Isolated here because the formats are undocumented and can break on a CLI
 * upgrade. Callers get picker rows (id + title + mtime) — never the
 * transcript body.
 */
import Database from 'better-sqlite3'
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  agyCliRoot,
  claudeProjectDir,
  codexSessionIdFromFilename,
  filterSessionsForCwd,
  grokProjectDir,
  mergeNativeSessions,
  nativeCwdsEqual,
  parseAgyHistoryJsonl,
  parseAgySummaryRow,
  parseClaudeJsonlPrefix,
  parseClaudeSessionsIndex,
  parseCodexJsonlPrefix,
  parseCodexThreadRow,
  parseGrokSummary,
  type NativeSession,
  type NativeSessionKind,
} from '../lib/nativeSessions.ts'

const JSONL_PREFIX_BYTES = 64 * 1024
const CODEX_PREFIX_BYTES = 32 * 1024

const INVALID_SESSION_ID =
  'Invalid native session id: expected one file-safe identifier without path separators.'
const UNSAFE_SESSION_FILE =
  'Native session transcript is not a regular file inside the expected session directory.'

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * Validate an id before it is ever used as a path component.
 *
 * Native ids are opaque values supplied by a picker/API caller. Keep the
 * validation deliberately conservative: trimming or normalising here could
 * silently select a different transcript than the caller requested.
 */
export function validateNativeSessionId(sessionId: string): string {
  if (
    typeof sessionId !== 'string' ||
    !sessionId ||
    sessionId !== sessionId.trim() ||
    sessionId === '.' ||
    sessionId === '..' ||
    sessionId.includes('/') ||
    sessionId.includes('\\') ||
    hasControlCharacters(sessionId)
  ) {
    throw new Error(INVALID_SESSION_ID)
  }
  return sessionId
}

/**
 * Resolve one id directly below an expected native-session directory.
 * Containment uses path.relative so a sibling such as `sessions-evil` cannot
 * pass a string-prefix check.
 */
function directSessionPath(directory: string, sessionId: string, suffix: string): string {
  const id = validateNativeSessionId(sessionId)
  const root = resolve(directory)
  const candidate = resolve(root, `${id}${suffix}`)
  const rel = relative(root, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.includes(sep)) {
    throw new Error(INVALID_SESSION_ID)
  }
  return candidate
}

/** Check that a file is regular and its resolved path stays below `directory`. */
function isRegularNativeFileInside(file: string, directory: string, directChild = false): boolean {
  let entry: ReturnType<typeof lstatSync>
  try {
    entry = lstatSync(file)
  } catch {
    return false
  }
  if (entry.isSymbolicLink() || !entry.isFile()) return false

  try {
    const realRoot = realpathSync(resolve(directory))
    const realFile = realpathSync(file)
    const rel = relative(realRoot, realFile)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
    return !directChild || !rel.includes(sep)
  } catch {
    return false
  }
}

/**
 * Existing session files must not be symlinks. Refusing them avoids a
 * time-of-check/read race and keeps a transcript id from redirecting reads
 * outside the directory the CLI owns.
 */
function assertRegularNativeFile(file: string, directory: string): void {
  if (existsSync(file) && !isRegularNativeFileInside(file, directory, true)) {
    throw new Error(UNSAFE_SESSION_FILE)
  }
}

/** Safe path for a native session file; existing symlinks are refused. */
export function safeNativeSessionFile(
  directory: string,
  sessionId: string,
  suffix: string,
): string {
  const file = directSessionPath(directory, sessionId, suffix)
  if (existsSync(file)) assertRegularNativeFile(file, directory)
  return file
}

/** Safe path for a native session directory (used by Grok's nested store). */
function safeNativeSessionDirectory(directory: string, sessionId: string): string {
  const path = directSessionPath(directory, sessionId, '')
  if (existsSync(path)) {
    let entry: ReturnType<typeof lstatSync>
    try {
      entry = lstatSync(path)
    } catch {
      throw new Error(UNSAFE_SESSION_FILE)
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(UNSAFE_SESSION_FILE)
  }
  return path
}

function homeDir(): string {
  return homedir()
}

function readPrefix(file: string, maxBytes: number): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    const n = readSync(fd, buf, 0, maxBytes, 0)
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

type NativeSessionAdapter = {
  list(cwd: string): NativeSession[]
  exists(cwd: string, sessionId: string): boolean
}

function stripCwd(rows: NativeSession[]): NativeSession[] {
  return rows.map(({ cwd: _cwd, ...row }) => row)
}

function claudeDir(cwd: string): string {
  return claudeProjectDir(homeDir(), resolve(cwd))
}

function listClaudeFromIndex(dir: string): NativeSession[] {
  const indexPath = join(dir, 'sessions-index.json')
  if (!existsSync(indexPath)) return []
  try {
    const json: unknown = JSON.parse(readFileSync(indexPath, 'utf8'))
    return parseClaudeSessionsIndex(json)
  } catch {
    return []
  }
}

function listClaudeFromJsonl(dir: string): NativeSession[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }

  const out: NativeSession[] = []
  for (const name of names) {
    if (extname(name) !== '.jsonl') continue
    const id = basename(name, '.jsonl')
    let file: string
    try {
      file = safeNativeSessionFile(dir, id, '.jsonl')
    } catch {
      continue
    }
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    try {
      const row = parseClaudeJsonlPrefix(readPrefix(file, JSONL_PREFIX_BYTES), {
        sessionIdFromFilename: basename(name, '.jsonl'),
        fileMtime: Math.trunc(st.mtimeMs),
      })
      if (row) out.push(row)
    } catch {
      // Unreadable / truncated files are skipped rather than failing the picker.
    }
  }
  return out
}

/** Where one Claude chat's JSONL lives, whether or not it exists. */
export function claudeSessionFile(cwd: string, sessionId: string): string {
  const dir = claudeDir(cwd)
  if (!cwd.trim() || !dir) throw new Error('Native session workspace folder is required.')
  return safeNativeSessionFile(dir, sessionId, '.jsonl')
}

const claudeAdapter: NativeSessionAdapter = {
  list(cwd) {
    const trimmed = cwd.trim()
    if (!trimmed) return []
    const dir = claudeDir(trimmed)
    if (!dir || !existsSync(dir)) return []
    return mergeNativeSessions(listClaudeFromIndex(dir), listClaudeFromJsonl(dir))
  },
  exists(cwd, sessionId) {
    if (!cwd.trim()) return false
    const file = claudeSessionFile(cwd, sessionId)
    try {
      return statSync(file).isFile()
    } catch {
      return false
    }
  },
}

function codexHome(): string {
  const override = process.env.CODEX_HOME?.trim()
  return override ? resolve(override) : join(homeDir(), '.codex')
}

function listCodexFromSqlite(cwd: string): NativeSession[] {
  const db = openReadonly(join(codexHome(), 'state_5.sqlite'))
  if (!db) return []
  try {
    const rows = db.prepare('SELECT * FROM threads').all() as unknown[]
    const parsed: NativeSession[] = []
    for (const row of rows) {
      const session = parseCodexThreadRow(row)
      if (session) parsed.push(session)
    }
    return filterSessionsForCwd(parsed, cwd)
  } catch {
    return []
  } finally {
    db.close()
  }
}

function walkFiles(dir: string, acc: string[]): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const file = join(dir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(file, acc)
    else acc.push(file)
  }
}

function listCodexFromJsonl(cwd: string): NativeSession[] {
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return []
  const files: string[] = []
  walkFiles(root, files)
  const out: NativeSession[] = []
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(file)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    if (!isRegularNativeFileInside(file, root)) continue
    try {
      const row = parseCodexJsonlPrefix(readPrefix(file, CODEX_PREFIX_BYTES), {
        sessionIdFromFilename: codexSessionIdFromFilename(basename(file)),
        fileMtime: Math.trunc(st.mtimeMs),
      })
      if (row) out.push(row)
    } catch {
      // Skip unreadable rollouts.
    }
  }
  return filterSessionsForCwd(out, cwd)
}

function findCodexJsonl(sessionId: string): string | null {
  const id = validateNativeSessionId(sessionId)
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return null
  const files: string[] = []
  walkFiles(root, files)
  const needle = `-${id}.jsonl`
  for (const file of files) {
    if (!file.endsWith(needle)) continue
    if (isRegularNativeFileInside(file, root)) return file
  }
  return null
}

const codexAdapter: NativeSessionAdapter = {
  list(cwd) {
    const trimmed = cwd.trim()
    if (!trimmed) return []
    const fromIndex = listCodexFromSqlite(trimmed)
    if (fromIndex.length > 0) return stripCwd(fromIndex)
    return stripCwd(listCodexFromJsonl(trimmed))
  },
  exists(cwd, sessionId) {
    if (!cwd.trim()) return false
    const id = validateNativeSessionId(sessionId)
    const fromIndex = listCodexFromSqlite(cwd)
    if (fromIndex.some((row) => row.sessionId === id)) return true
    const file = findCodexJsonl(id)
    if (!file) return false
    try {
      const row = parseCodexJsonlPrefix(readPrefix(file, CODEX_PREFIX_BYTES), {
        sessionIdFromFilename: id,
        fileMtime: 0,
      })
      return Boolean(row && (!row.cwd || nativeCwdsEqual(row.cwd, cwd)))
    } catch {
      return false
    }
  },
}

function grokHome(): string {
  const override = process.env.GROK_HOME?.trim()
  return override ? resolve(override) : join(homeDir(), '.grok')
}

function grokDirFor(cwd: string): string {
  return grokProjectDir(grokHome(), resolve(cwd))
}

function listGrokInDir(dir: string): NativeSession[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: NativeSession[] = []
  for (const name of names) {
    let sessionDir: string
    try {
      sessionDir = safeNativeSessionDirectory(dir, name)
    } catch {
      continue
    }
    const summaryPath = join(sessionDir, 'summary.json')
    if (!existsSync(summaryPath)) continue
    try {
      assertRegularNativeFile(summaryPath, sessionDir)
    } catch {
      continue
    }
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(summaryPath)
    } catch {
      continue
    }
    try {
      const json: unknown = JSON.parse(readFileSync(summaryPath, 'utf8'))
      const row = parseGrokSummary(json, Math.trunc(st.mtimeMs))
      if (row) out.push(row)
    } catch {
      // Skip unreadable summaries.
    }
  }
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

const grokAdapter: NativeSessionAdapter = {
  list(cwd) {
    const trimmed = cwd.trim()
    if (!trimmed) return []
    const dir = grokDirFor(trimmed)
    if (!dir || !existsSync(dir)) return []
    return stripCwd(filterSessionsForCwd(listGrokInDir(dir), trimmed))
  },
  exists(cwd, sessionId) {
    if (!cwd.trim()) return false
    const id = validateNativeSessionId(sessionId)
    const sessionDir = safeNativeSessionDirectory(grokDirFor(cwd), id)
    const file = join(sessionDir, 'summary.json')
    try {
      assertRegularNativeFile(file, sessionDir)
      return statSync(file).isFile()
    } catch {
      return false
    }
  },
}

function agyRoot(): string {
  const override = process.env.ANTIGRAVITY_CLI_ROOT?.trim()
  return override ? resolve(override) : agyCliRoot(homeDir())
}

function listAgyFromSummaries(): NativeSession[] {
  const db = openReadonly(join(agyRoot(), 'conversation_summaries.db'))
  if (!db) return []
  try {
    const rows = db.prepare('SELECT * FROM conversation_summaries').all() as unknown[]
    const out: NativeSession[] = []
    for (const row of rows) {
      const session = parseAgySummaryRow(row)
      if (session) out.push(session)
    }
    return out
  } catch {
    return []
  } finally {
    db.close()
  }
}

function listAgyFromHistory(): NativeSession[] {
  const file = join(agyRoot(), 'history.jsonl')
  if (!existsSync(file)) return []
  try {
    return parseAgyHistoryJsonl(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}

function agyConversationFile(sessionId: string): string {
  return safeNativeSessionFile(join(agyRoot(), 'conversations'), sessionId, '.db')
}

function agyConversationExists(sessionId: string): boolean {
  try {
    return statSync(agyConversationFile(sessionId)).isFile()
  } catch {
    return false
  }
}

const agyAdapter: NativeSessionAdapter = {
  list(cwd) {
    const trimmed = cwd.trim()
    if (!trimmed) return []
    const merged = filterSessionsForCwd(
      mergeNativeSessions(listAgyFromSummaries(), listAgyFromHistory()),
      trimmed,
    ).filter((row) => agyConversationExists(row.sessionId))
    return stripCwd(merged)
  },
  exists(cwd, sessionId) {
    const id = sessionId.trim()
    if (!id || !cwd.trim()) return false
    if (!agyConversationExists(id)) return false
    return this.list(cwd).some((row) => row.sessionId === id)
  },
}

const adapters: Record<NativeSessionKind, NativeSessionAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
  antigravity: agyAdapter,
}

export function listNativeSessionsForKind(cwd: string, kind: NativeSessionKind): NativeSession[] {
  // Adapters read different on-disk stores whose natural row order is not
  // consistent (notably Codex's SQLite threads table). Keep the picker and
  // its paginated "load more" results newest-first for every runtime.
  return adapters[kind].list(cwd).sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function nativeSessionExists(
  cwd: string,
  kind: NativeSessionKind,
  sessionId: string,
): boolean {
  try {
    validateNativeSessionId(sessionId)
    return adapters[kind].exists(cwd, sessionId)
  } catch {
    // Existence is a probe, not a read boundary: malformed ids must be safely
    // absent and must never be allowed to influence a filesystem path.
    return false
  }
}

export function nativeSessionTitle(
  cwd: string,
  kind: NativeSessionKind,
  sessionId: string,
): string {
  const id = sessionId.trim()
  if (!id) return ''
  return adapters[kind].list(cwd).find((row) => row.sessionId === id)?.title ?? ''
}
