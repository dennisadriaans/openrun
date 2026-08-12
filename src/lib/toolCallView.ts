/**
 * Presentation model for one ACP tool call in the transcript.
 *
 * A coding agent reports Bash / Read / Edit (or Codex `command_execution`) as
 * `tool_start` / `tool_result` events with an ACP `kind` (execute / read /
 * edit / …). This module turns that payload into a verb + target so chat can
 * render a compact row instead of dumping `Bash · command` titles and JSON.
 */
import { toolKindFromName, type ToolCallLocation, type ToolCallStatus, type ToolKind } from './acp.ts'

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
  if (kind === 'fetch') return running ? 'Fetching' : 'Fetched'
  if (kind === 'think') return running ? 'Thinking' : 'Thought'
  if (kind === 'switch_mode') return running ? 'Switching' : 'Switched'
  return name?.trim() || 'Tool'
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
    const url = pickString(obj ?? {}, 'url', 'uri', 'href') || fallback
    if (url) return { type: 'url', url }
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
  const kind = input.toolKind ?? toolKindFromName(input.name)
  const locations = input.locations ?? []
  return {
    kind,
    verb: toolCallVerb(kind, input.name, input.status),
    target: targetFrom(kind, input.name, input.toolInput, locations, input.title),
    hunks: kind === 'edit' ? editHunksFromInput(input.toolInput) : [],
    locations,
  }
}
