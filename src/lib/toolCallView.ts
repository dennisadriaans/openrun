/**
 * Presentation model for one ACP tool call in the transcript.
 *
 * A coding agent reports Bash / Read / Edit (or Codex `command_execution`) as
 * `tool_start` / `tool_result` events with an ACP `kind` (execute / read /
 * edit / …). This module turns that payload into a verb + target so chat can
 * render a compact row instead of dumping `Bash · command` titles and JSON.
 */
import {
  toolKindFromName,
  resolveToolKind,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from './acp.ts'

export type DisplayPath = {
  path: string
  dir: string
  name: string
  line?: number
}

export type ToolCallTarget =
  | { type: 'path'; path: DisplayPath }
  | { type: 'command'; command: string; description?: string }
  | { type: 'pattern'; pattern: string; scope?: string }
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }

export type ToolCallEditHunk = {
  oldString?: string
  newString?: string
}

export type ToolCallView = {
  kind: ToolKind
  verb: string
  target: ToolCallTarget
  hunks: ToolCallEditHunk[]
  locations: ToolCallLocation[]
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function inputRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  return input as Record<string, unknown>
}

/** Last two directory segments + basename, so absolute agent paths stay readable. */
export function displayPath(path: string, line?: number): DisplayPath {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  const name = parts.pop() ?? path
  const dir = parts.slice(-2).join('/')
  return line === undefined ? { path, dir, name } : { path, dir, name, line }
}

function detailFromTitle(title: string | undefined): string {
  if (!title) return ''
  const idx = title.indexOf(' · ')
  return (idx >= 0 ? title.slice(idx + 3) : title).trim()
}

function runningVerb(status: ToolCallStatus | undefined): boolean {
  return status === 'pending' || status === 'in_progress'
}

/**
 * A readable label for a tool we have no verb for.
 *
 * Custom and MCP tools are named for machines — `create_issue`,
 * `createIssue`, `mcp__linear__create_issue` — and rendering that raw in the
 * transcript is the difference between a row that reads like a sentence and
 * one that reads like a log line. The MCP prefix is dropped because the server
 * is shown separately.
 */
export function humanizeToolName(name: string | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  const bare = raw.replace(/^mcp[_.]{1,2}.*?[_.]{2}/i, '').replace(/^mcp[_.]/i, '')
  const words = bare
    .replace(/[_.-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!words) return raw
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function toolCallVerb(
  kind: ToolKind,
  name: string | undefined,
  status?: ToolCallStatus,
): string {
  const running = runningVerb(status)
  const n = (name ?? '').toLowerCase()

  if (kind === 'read') return running ? 'Reading' : 'Read'
  if (kind === 'edit') {
    if (n === 'write' || n.startsWith('write')) return running ? 'Writing' : 'Wrote'
    return running ? 'Editing' : 'Edited'
  }
  if (kind === 'delete') return running ? 'Deleting' : 'Deleted'
  if (kind === 'move') return running ? 'Moving' : 'Moved'
  if (kind === 'search') {
    if (n === 'glob' || n === 'ls' || n === 'listdir') return running ? 'Finding' : 'Found'
    return running ? 'Searching' : 'Searched'
  }
  if (kind === 'execute') return running ? 'Running' : 'Ran'
  if (kind === 'fetch') {
    if (n.includes('search')) return running ? 'Searching' : 'Searched'
    return running ? 'Fetching' : 'Fetched'
  }
  if (kind === 'think') return running ? 'Thinking' : 'Thought'
  if (kind === 'switch_mode') return running ? 'Switching' : 'Switched'
  return humanizeToolName(name) || 'Tool'
}

function pathFromInput(
  obj: Record<string, unknown> | undefined,
  locations: ToolCallLocation[],
): DisplayPath | undefined {
  const loc = locations[0]
  if (loc?.path) return displayPath(loc.path, loc.line)
  if (!obj) return undefined
  const path = pickString(obj, 'file_path', 'filePath', 'path', 'target_file', 'notebook_path')
  if (!path) return undefined
  const rawLine = obj.line ?? obj.line_number ?? obj.offset
  const line = typeof rawLine === 'number' && Number.isFinite(rawLine) ? rawLine : undefined
  return displayPath(path, line)
}

export function editHunksFromInput(input: unknown): ToolCallEditHunk[] {
  const obj = inputRecord(input)
  if (!obj) return []
  if (Array.isArray(obj.edits)) {
    const hunks: ToolCallEditHunk[] = []
    for (const entry of obj.edits) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const rec = entry as Record<string, unknown>
      const oldString = pickString(rec, 'old_string', 'oldString', 'old')
      const newString = pickString(rec, 'new_string', 'newString', 'new')
      if (oldString || newString) hunks.push({ oldString, newString })
    }
    return hunks
  }
  const oldString = pickString(obj, 'old_string', 'oldString', 'old')
  const newString = pickString(obj, 'new_string', 'newString', 'new')
  if (oldString || newString) return [{ oldString, newString }]
  const contents = pickString(obj, 'contents', 'content')
  if (contents) return [{ newString: contents }]
  return []
}

function targetFrom(
  kind: ToolKind,
  name: string | undefined,
  input: unknown,
  locations: ToolCallLocation[],
  title: string | undefined,
): ToolCallTarget {
  const obj = inputRecord(input)
  const fallback = detailFromTitle(title)

  if (kind === 'execute') {
    const command = pickString(obj ?? {}, 'command', 'cmd') || fallback
    const description = pickString(obj ?? {}, 'description')
    if (command) {
      return description ? { type: 'command', command, description } : { type: 'command', command }
    }
  }

  if (kind === 'search') {
    const pattern = pickString(obj ?? {}, 'pattern', 'query', 'glob') || fallback
    const scope = pickString(obj ?? {}, 'path', 'file_path', 'filePath')
    if (pattern) {
      return scope ? { type: 'pattern', pattern, scope } : { type: 'pattern', pattern }
    }
  }

  if (kind === 'fetch') {
    const url = pickString(obj ?? {}, 'url', 'uri', 'href')
    if (url) return { type: 'url', url }
    const query = pickString(obj ?? {}, 'query')
    if (query) return { type: 'text', text: query }
    if (fallback) {
      if (/^https?:\/\//i.test(fallback) || fallback.startsWith('//')) {
        return { type: 'url', url: fallback }
      }
      return { type: 'text', text: fallback }
    }
  }

  const path = pathFromInput(obj, locations)
  if (path) return { type: 'path', path }

  if (fallback) {
    if (fallback.startsWith('/') || fallback.includes('/') || fallback.includes('\\')) {
      return { type: 'path', path: displayPath(fallback) }
    }
    if (kind === 'execute') return { type: 'command', command: fallback }
    return { type: 'text', text: fallback }
  }

  return { type: 'text', text: name?.trim() || 'tool' }
}

export function toolCallView(input: {
  name?: string
  title?: string
  toolKind?: ToolKind
  status?: ToolCallStatus
  toolInput?: unknown
  locations?: ToolCallLocation[]
}): ToolCallView {
  const kind =
    resolveToolKind(input.name, input.toolKind, input.toolInput, input.title) ??
    toolKindFromName(input.name)
  const locations = input.locations ?? []
  return {
    kind,
    verb: toolCallVerb(kind, input.name, input.status),
    target: targetFrom(kind, input.name, input.toolInput, locations, input.title),
    hunks: kind === 'edit' ? editHunksFromInput(input.toolInput) : [],
    locations,
  }
}

export function hasEditHunks(input: {
  name?: string
  title?: string
  toolKind?: ToolKind
  toolInput?: unknown
  locations?: ToolCallLocation[]
}): boolean {
  return toolCallView(input).hunks.length > 0
}

/** One row of the key/value table shown for a tool we have no layout for. */
export type ToolCallField = {
  key: string
  label: string
  value: string
  /** Render in a block rather than on the same line as the label. */
  block: boolean
}

/** Input keys the row header already shows, so the table does not repeat them. */
const SHOWN_IN_HEADER = new Set([
  'command',
  'cmd',
  'file_path',
  'filePath',
  'path',
  'target_file',
  'notebook_path',
  'pattern',
  'query',
  'glob',
  'url',
  'uri',
  'href',
  'old_string',
  'oldString',
  'new_string',
  'newString',
  'contents',
  'content',
  'edits',
])

function fieldValue(value: unknown): { text: string; block: boolean } {
  if (typeof value === 'string') {
    return { text: value, block: value.includes('\n') || value.length > 60 }
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return { text: String(value), block: false }
  }
  try {
    const json = JSON.stringify(value, null, 2)
    return { text: json, block: json.includes('\n') }
  } catch {
    return { text: String(value), block: false }
  }
}

/**
 * Arguments of a custom / MCP tool as labelled rows.
 *
 * An MCP server can name its arguments anything, so there is no layout to
 * recognise — but a table of `issue id: ENG-42` still reads better than the
 * JSON blob, and long values keep their own block so a prompt argument is
 * readable. `target` is what the row header already renders; those keys are
 * skipped here.
 */
export function toolCallFields(input: unknown, target?: ToolCallTarget): ToolCallField[] {
  const obj = inputRecord(input)
  if (!obj) return []
  const skipHeader = target === undefined || target.type !== 'text'
  const out: ToolCallField[] = []
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === undefined) continue
    if (skipHeader && SHOWN_IN_HEADER.has(key)) continue
    if (typeof raw === 'string' && raw.trim() === '') continue
    const { text, block } = fieldValue(raw)
    out.push({ key, label: humanizeToolName(key), value: text, block })
  }
  return out
}

/**
 * Pretty-print a tool result that is really JSON.
 *
 * MCP servers commonly answer with a single JSON string, which the transcript
 * used to show as one unbroken line. Anything that is not JSON comes back
 * untouched.
 */
export function formatToolResult(result: string): string {
  const trimmed = result.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return result
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return result
  }
}
