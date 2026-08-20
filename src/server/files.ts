/**
 * Workspace file browsing and editing.
 *
 * Every path crossing this module is resolved against the run's working
 * directory and rejected if it escapes — the run cwd is the trust boundary,
 * so `../` traversal, absolute paths and symlinks pointing outside are all
 * refused before any read or write happens.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/** Directories never worth listing in a code workspace. */
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.output',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'target',
  'vendor',
])

/** Files larger than this are not editable in the browser. */
const MAX_EDITABLE_BYTES = 2 * 1024 * 1024

export type FileEntry = {
  name: string
  /** Path relative to the workspace root, POSIX-style. */
  path: string
  kind: 'file' | 'directory'
  size: number
}

export type FileContent = {
  path: string
  content: string
  size: number
  /** True when the file is binary or too large to edit. */
  readOnly: boolean
  reason?: string
}

/**
 * Resolve `relPath` inside `root`, refusing anything that escapes.
 *
 * Both sides are realpath'd where they exist so a symlink cannot be used to
 * step outside the workspace.
 */
function safeResolve(root: string, relPath: string): string {
  if (relPath.includes('\0')) throw new Error('Invalid path')

  const rootReal = existsSync(root) ? realpathSync(root) : resolve(root)
  const target = resolve(rootReal, relPath)

  // Resolve symlinks on the nearest existing ancestor: the target itself may
  // not exist yet (new file), but its parent chain must stay inside the root.
  let probe = target
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const probeReal = realpathSync(probe)

  const withinProbe = probeReal === rootReal || probeReal.startsWith(rootReal + sep)
  if (!withinProbe) throw new Error('Path escapes the workspace')

  // Re-anchor the unresolved remainder onto the realpath'd ancestor.
  const remainder = relative(probe, target)
  const finalPath = remainder ? join(probeReal, remainder) : probeReal
  if (finalPath !== rootReal && !finalPath.startsWith(rootReal + sep)) {
    throw new Error('Path escapes the workspace')
  }
  return finalPath
}

/** Convert an absolute path back to a workspace-relative POSIX path. */
function toRelative(root: string, absolute: string): string {
  const rootReal = existsSync(root) ? realpathSync(root) : resolve(root)
  return relative(rootReal, absolute).split(sep).join('/')
}

/**
 * List the direct children of `dir` (relative to the workspace root).
 *
 * Shallow by design — the tree loads lazily as folders are expanded, so a
 * large repo never blocks the panel.
 */
export function listDirectory(cwd: string, dir = ''): FileEntry[] {
  const absolute = safeResolve(cwd, dir || '.')
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return []

  const entries: FileEntry[] = []
  for (const item of readdirSync(absolute, { withFileTypes: true })) {
    // Match by name regardless of type: in a git worktree `.git` is a file
    // (a pointer to the real gitdir), not a directory.
    if (IGNORED_DIRS.has(item.name)) continue

    const childAbs = join(absolute, item.name)
    let size = 0
    let isDir = item.isDirectory()
    try {
      // stat (not lstat) so symlinked files report their target's size; a
      // broken or escaping link simply gets skipped below.
      const st = statSync(childAbs)
      isDir = st.isDirectory()
      size = st.size
    } catch {
      continue
    }

    entries.push({
      name: item.name,
      path: toRelative(cwd, childAbs),
      kind: isDir ? 'directory' : 'file',
      size,
    })
  }

  // Directories first, then case-insensitive by name.
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** Heuristic binary check: a NUL byte in the first 8KB. */
function looksBinary(buf: Buffer): boolean {
  const window = buf.subarray(0, 8192)
  return window.includes(0)
}

/** Read a workspace file for viewing or editing. */
export function readWorkspaceFile(cwd: string, path: string): FileContent {
  const absolute = safeResolve(cwd, path)
  if (!existsSync(absolute)) throw new Error('File not found')

  const st = statSync(absolute)
  if (st.isDirectory()) throw new Error('Path is a directory')

  if (st.size > MAX_EDITABLE_BYTES) {
    return {
      path,
      content: '',
      size: st.size,
      readOnly: true,
      reason: 'File is too large to open in the editor.',
    }
  }

  const buf = readFileSync(absolute)
  if (looksBinary(buf)) {
    return {
      path,
      content: '',
      size: st.size,
      readOnly: true,
      reason: 'Binary file.',
    }
  }

  return { path, content: buf.toString('utf8'), size: st.size, readOnly: false }
}

/**
 * Overwrite a workspace file.
 *
 * Only existing regular files may be written — creating new files is not
 * exposed here, so a bad path cannot scatter files through the workspace.
 */
export function writeWorkspaceFile(
  cwd: string,
  path: string,
  content: string,
): { path: string; size: number } {
  const absolute = safeResolve(cwd, path)
  if (!existsSync(absolute)) throw new Error('File not found')

  const st = statSync(absolute)
  if (st.isDirectory()) throw new Error('Path is a directory')
  if (st.size > MAX_EDITABLE_BYTES) throw new Error('File is too large to edit')

  writeFileSync(absolute, content, 'utf8')
  return { path, size: Buffer.byteLength(content, 'utf8') }
}

/**
 * Write a file, creating it when missing. Used to redo a chat Undo after the
 * run had added the file and discard removed it.
 */
export function putWorkspaceFile(
  cwd: string,
  path: string,
  content: string,
): { path: string; size: number } {
  const absolute = safeResolve(cwd, path)
  if (existsSync(absolute) && statSync(absolute).isDirectory()) {
    throw new Error('Path is a directory')
  }
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
  return { path, size: Buffer.byteLength(content, 'utf8') }
}
