/**
 * Recognise a workspace file reference inside prose.
 *
 * Agents write paths as inline code (`src/lib/diff.ts:42`) far more often than
 * as markdown links, and the transcript turns those into buttons that open the
 * file in the right panel. Kept strict on purpose: a false positive turns an
 * ordinary word into a dead link.
 */

export type FilePathToken = {
  /** Path exactly as written, minus any `:line` suffix. */
  path: string
  line?: number
}

const LINE_SUFFIX = /:(\d+)(?::\d+)?$/
const PATH_SHAPE = /^[\w@.~/-]+$/
const HAS_EXTENSION = /\.[A-Za-z0-9]{1,12}$/

/** Names that carry no extension but are still files worth linking. */
const EXTENSIONLESS_FILES = new Set([
  'Dockerfile',
  'Makefile',
  'Procfile',
  'LICENSE',
  'NOTICE',
  'README',
  'CHANGELOG',
])

/**
 * Parse an inline-code span into a path + optional line, or null when the text
 * is anything else (a command, an identifier, a flag, prose).
 */
export function parseFilePathToken(text: string): FilePathToken | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 200) return null
  if (/\s/.test(trimmed)) return null

  const lineMatch = LINE_SUFFIX.exec(trimmed)
  const line = lineMatch ? Number(lineMatch[1]) : undefined
  const path = lineMatch ? trimmed.slice(0, lineMatch.index) : trimmed
  if (!path || !PATH_SHAPE.test(path)) return null
  // A protocol or a bare domain is a URL, not a path in this workspace.
  if (path.includes('://') || path.startsWith('www.')) return null

  const name = path.split('/').pop() ?? ''
  if (!name) return null
  if (!HAS_EXTENSION.test(name) && !EXTENSIONLESS_FILES.has(name)) return null

  return line === undefined ? { path } : { path, line }
}

/** Strip a leading workspace root so the chip shows a repo-relative path. */
export function relativeToWorkspace(path: string, workspaceRoot?: string): string {
  if (!workspaceRoot) return path
  const root = workspaceRoot.endsWith('/') ? workspaceRoot : `${workspaceRoot}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}
