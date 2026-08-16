/**
 * Git integration for run workspaces.
 *
 * The "Files Changed" panel reads the live working tree of a run's cwd, so it
 * works with every runtime (including ones that emit no structured output).
 * Everything shells out to the `git` binary — no libgit dependency — and every
 * call is scoped with `-C <cwd>` so we never touch the app's own repo by
 * accident.
 *
 * When a run has a `baseSnapshot` (captured at start), diffs/commits/discards
 * are scoped to the delta from that snapshot so pre-existing dirt is ignored.
 */
import { spawnSync } from 'node:child_process'
import { ensureProcessPathAugmented, findOnPath } from './userPath.ts'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ghNotAuthenticatedMessage,
  ghNotInstalledMessage,
  missingOriginRemoteMessage,
} from '../lib/gitActionGate.ts'
import { parseGitForEachRef, type GitBranchRow } from '../lib/gitBranches.ts'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export type DiffFile = {
  path: string
  /** Previous path, set only for renames. */
  oldPath: string | null
  status: FileStatus
  additions: number
  deletions: number
  /** True when git reported the blob as binary (no line counts available). */
  binary: boolean
}

export type RepoInfo = {
  isRepo: boolean
  branch: string
  /** Short SHA of HEAD, empty on an unborn branch. */
  head: string
  remote: string
  /** True when the branch has an upstream tracking ref. */
  hasUpstream: boolean
  ahead: number
  dirty: boolean
}

const MAX_BUFFER = 32 * 1024 * 1024

function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extra }
}

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const res = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      env: env ?? gitEnv(),
    })
    return {
      ok: res.status === 0,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    }
  } catch (err) {
    return { ok: false, stdout: '', stderr: String(err) }
  }
}

/**
 * Extract the actionable line from git's stderr.
 *
 * Git writes progress to stderr alongside errors ("Preparing worktree…" then
 * "fatal: a branch named 'x' already exists"), so surfacing the raw first line
 * would show the user chatter instead of the reason. Prefer the fatal/error
 * line when one is present.
 */
function gitErrorMessage(stderr: string, fallback: string): string {
  const lines = stderr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const fatal = lines.find((l) => /^(fatal|error):/i.test(l))
  if (fatal) return fatal.replace(/^(fatal|error):\s*/i, '')
  return lines.join('\n') || fallback
}

/** Run a git command and throw with stderr when it fails — used by write paths. */
function gitOrThrow(cwd: string, args: string[]): string {
  const res = git(cwd, args)
  if (!res.ok) {
    throw new Error(gitErrorMessage(res.stderr, `git ${args[0]} failed`))
  }
  return res.stdout
}

export function isRepo(cwd: string): boolean {
  if (!cwd) return false
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true'
}

export function currentBranch(cwd: string): string {
  if (!isRepo(cwd)) return ''
  return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
}

export function repoInfo(cwd: string): RepoInfo {
  const empty: RepoInfo = {
    isRepo: false,
    branch: '',
    head: '',
    remote: '',
    hasUpstream: false,
    ahead: 0,
    dirty: false,
  }
  if (!isRepo(cwd)) return empty

  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  const head = git(cwd, ['rev-parse', '--short', 'HEAD']).stdout.trim()
  const remote = git(cwd, ['remote', 'get-url', 'origin']).stdout.trim()
  const upstream = git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const hasUpstream = upstream.ok && upstream.stdout.trim().length > 0

  let ahead = 0
  if (hasUpstream) {
    const counts = git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']).stdout.trim()
    ahead = Number(counts.split(/\s+/)[1] ?? 0) || 0
  }

  const dirty = git(cwd, ['status', '--porcelain']).stdout.trim().length > 0

  return { isRepo: true, branch, head, remote, hasUpstream, ahead, dirty }
}

function statusFromCode(code: string): FileStatus {
  if (code.startsWith('R')) return 'renamed'
  if (code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  return 'modified'
}

/** True when `path` exists as a blob in `ref`'s tree. */
function pathInTree(cwd: string, ref: string, path: string): boolean {
  return git(cwd, ['cat-file', '-e', `${ref}:${path}`]).ok
}

/** Object name of the working-tree file, or '' if missing/unreadable. */
function hashWorkingFile(cwd: string, path: string): string {
  const res = git(cwd, ['hash-object', '--', path])
  return res.ok ? res.stdout.trim() : ''
}

function blobAt(cwd: string, ref: string, path: string): string {
  const res = git(cwd, ['rev-parse', `${ref}:${path}`])
  return res.ok ? res.stdout.trim() : ''
}

function untrackedLineStats(
  cwd: string,
  path: string,
): { additions: number; deletions: number; binary: boolean } {
  const stat = git(cwd, ['diff', '--no-index', '--numstat', '/dev/null', path]).stdout
  const m = stat.match(/^(\d+|-)\t(\d+|-)\t/)
  const binary = m ? m[1] === '-' : false
  return {
    additions: binary || !m ? 0 : Number(m[1]),
    deletions: 0,
    binary,
  }
}

/**
 * Freeze the full working tree (tracked dirt + untracked) into an object-db
 * commit without mutating the real index or worktree. Uses a temporary
 * GIT_INDEX_FILE so `git add -A` never touches `.git/index`.
 *
 * Returns the snapshot SHA, or HEAD when the tree matches HEAD / on failure,
 * or '' when cwd is not a repo.
 */
export function captureBaseSnapshot(cwd: string): string {
  if (!isRepo(cwd)) return ''

  const head = git(cwd, ['rev-parse', 'HEAD']).stdout.trim()
  if (!head) return ''

  const dir = mkdtempSync(join(tmpdir(), 'agentops-snap-'))
  const indexPath = join(dir, 'index')
  const env = gitEnv({ GIT_INDEX_FILE: indexPath })

  try {
    const read = git(cwd, ['read-tree', 'HEAD'], env)
    if (!read.ok) return head

    const add = git(cwd, ['add', '-A'], env)
    if (!add.ok) return head

    const tree = git(cwd, ['write-tree'], env).stdout.trim()
    if (!tree) return head

    const commit = git(
      cwd,
      ['commit-tree', tree, '-p', head, '-m', 'run base snapshot'],
      env,
    ).stdout.trim()
    return commit || head
  } catch {
    return head
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * List files that differ from `since` (or HEAD when omitted) in the working
 * tree, including staged changes and untracked files, with per-file line counts.
 *
 * When `since` is a run base snapshot, pre-existing dirt captured in that
 * snapshot is excluded; only paths that changed after the snapshot appear.
 */
export function changedFiles(cwd: string, since?: string): DiffFile[] {
  if (!isRepo(cwd)) return []

  const base = since && since.length > 0 ? since : 'HEAD'
  const files = new Map<string, DiffFile>()

  // Tracked / snapshot-tree changes relative to base, with rename detection.
  const nameStatus = git(cwd, ['diff', base, '--name-status', '-M', '-z']).stdout
  const parts = nameStatus.split('\0').filter((p) => p.length > 0)
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]!
    if (code.startsWith('R')) {
      const oldPath = parts[++i] ?? ''
      const path = parts[++i] ?? ''
      files.set(path, {
        path,
        oldPath,
        status: 'renamed',
        additions: 0,
        deletions: 0,
        binary: false,
      })
    } else {
      const path = parts[++i] ?? ''
      if (!path) continue
      // Snapshot trees include then-untracked files. `git diff <snap>` reports
      // those as deleted when they still exist on disk as untracked — skip
      // unchanged ones and treat content changes as modifications instead.
      if (code.includes('D') && existsSync(join(cwd, path))) {
        const prev = blobAt(cwd, base, path)
        const cur = hashWorkingFile(cwd, path)
        if (prev && cur && prev === cur) continue
        files.set(path, {
          path,
          oldPath: null,
          status: 'modified',
          additions: 0,
          deletions: 0,
          binary: false,
        })
        continue
      }
      files.set(path, {
        path,
        oldPath: null,
        status: statusFromCode(code),
        additions: 0,
        deletions: 0,
        binary: false,
      })
    }
  }

  const numstat = git(cwd, ['diff', base, '--numstat', '-M', '-z']).stdout
  const nparts = numstat.split('\0').filter((p) => p.length > 0)
  for (let i = 0; i < nparts.length; i++) {
    const line = nparts[i]!
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (!m) continue
    const [, addRaw, delRaw, tail] = m
    let path = tail!
    if (path === '') {
      i++ // old path
      path = nparts[++i] ?? ''
    }
    const entry = files.get(path)
    if (!entry) continue
    entry.binary = addRaw === '-' || delRaw === '-'
    entry.additions = entry.binary ? 0 : Number(addRaw)
    entry.deletions = entry.binary ? 0 : Number(delRaw)
  }

  // Untracked files — include only those new or changed since the snapshot.
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).stdout
  for (const path of untracked.split('\0').filter((p) => p.length > 0)) {
    if (files.has(path)) {
      // Prefer live file stats over false-delete numstat from snapshot diffs.
      const entry = files.get(path)!
      const stats = untrackedLineStats(cwd, path)
      entry.additions = stats.additions
      entry.deletions = stats.deletions
      entry.binary = stats.binary
      continue
    }

    if (since && since.length > 0 && pathInTree(cwd, base, path)) {
      const prev = blobAt(cwd, base, path)
      const cur = hashWorkingFile(cwd, path)
      if (prev && cur && prev === cur) continue
      // Content changed since snapshot but still untracked vs HEAD.
      const stats = untrackedLineStats(cwd, path)
      files.set(path, {
        path,
        oldPath: null,
        status: 'modified',
        additions: stats.additions,
        deletions: stats.deletions,
        binary: stats.binary,
      })
      continue
    }

    const stats = untrackedLineStats(cwd, path)
    files.set(path, {
      path,
      oldPath: null,
      status: 'untracked',
      additions: stats.additions,
      deletions: 0,
      binary: stats.binary,
    })
  }

  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** True when the working tree has any delta relative to `since` (or HEAD). */
export function isDirtySince(cwd: string, since?: string): boolean {
  return changedFiles(cwd, since).length > 0
}

/**
 * Unified diff text for a single file relative to `since` (or HEAD).
 * Untracked files new since the baseline are diffed against /dev/null.
 */
export function fileDiff(cwd: string, path: string, since?: string): string {
  if (!isRepo(cwd)) return ''

  const base = since && since.length > 0 ? since : 'HEAD'
  const tracked = git(cwd, ['ls-files', '--error-unmatch', '--', path]).ok

  if (!tracked) {
    if (since && since.length > 0 && pathInTree(cwd, base, path)) {
      // Was in the snapshot (untracked at start); show delta from that blob.
      return git(cwd, ['diff', base, '--', path]).stdout
    }
    // --no-index exits 1 when files differ, which is the normal case here.
    return git(cwd, ['diff', '--no-index', '--', '/dev/null', path]).stdout
  }
  return git(cwd, ['diff', base, '-M', '--', path]).stdout
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

/** Stage the given paths (or everything when omitted) and commit. */
export function commit(cwd: string, message: string, paths?: string[]): { sha: string } {
  if (!isRepo(cwd)) throw new Error('Not a git repository')
  if (!message.trim()) throw new Error('Commit message is required')

  if (paths && paths.length > 0) {
    gitOrThrow(cwd, ['add', '--', ...paths])
  } else {
    gitOrThrow(cwd, ['add', '-A'])
  }

  const staged = git(cwd, ['diff', '--cached', '--name-only']).stdout.trim()
  if (!staged) throw new Error('Nothing staged to commit')

  gitOrThrow(cwd, ['commit', '-m', message])
  return { sha: git(cwd, ['rev-parse', '--short', 'HEAD']).stdout.trim() }
}

/** Create and switch to a new branch. */
export function createBranch(cwd: string, name: string) {
  gitOrThrow(cwd, ['checkout', '-b', name])
  return { branch: name }
}

/** Push the current branch, setting upstream when it has none. */
export function push(cwd: string): { branch: string; output: string } {
  if (!isRepo(cwd)) throw new Error('Not a git repository')
  const branch = currentBranch(cwd)
  if (!branch || branch === 'HEAD') throw new Error('Cannot push a detached HEAD')

  const info = repoInfo(cwd)
  if (!info.remote) throw new Error(missingOriginRemoteMessage())

  const args = info.hasUpstream
    ? ['push', 'origin', branch]
    : ['push', '--set-upstream', 'origin', branch]
  const res = git(cwd, args)
  if (!res.ok) throw new Error(res.stderr.trim() || 'git push failed')
  // git push writes progress to stderr even on success.
  return { branch, output: (res.stdout + res.stderr).trim() }
}

/**
 * Restore files. When `since` is set, restores from that snapshot (run-scoped
 * discard). Without `since`, restores to HEAD / removes untracked (legacy).
 *
 * Omitting `paths` discards every path in the run delta (when `since` is set)
 * or the entire dirty tree (legacy).
 */
export function discard(
  cwd: string,
  paths?: string[],
  since?: string,
): { discarded: 'all' | number } {
  if (!isRepo(cwd)) throw new Error('Not a git repository')

  const base = since && since.length > 0 ? since : undefined

  if (base) {
    const targets =
      paths && paths.length > 0
        ? paths
        : changedFiles(cwd, base).flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path]))
    if (targets.length === 0) return { discarded: paths && paths.length > 0 ? 0 : 'all' }

    for (const path of targets) {
      if (pathInTree(cwd, base, path)) {
        // Put snapshot content into index + worktree, then reset the index so
        // pre-existing dirt stays unstaged (worktree retains snapshot bytes).
        git(cwd, ['checkout', base, '--', path])
        if (pathInTree(cwd, 'HEAD', path)) {
          git(cwd, ['reset', 'HEAD', '--', path])
        } else {
          git(cwd, ['rm', '--cached', '-f', '--', path])
        }
      } else {
        // Created during the run — remove from worktree (and index if staged).
        const tracked = git(cwd, ['ls-files', '--error-unmatch', '--', path]).ok
        if (tracked) {
          git(cwd, ['rm', '-f', '--', path])
        } else {
          git(cwd, ['clean', '-fd', '--', path])
        }
      }
    }
    return { discarded: paths && paths.length > 0 ? paths.length : 'all' }
  }

  if (!paths || paths.length === 0) {
    gitOrThrow(cwd, ['reset', '--hard', 'HEAD'])
    gitOrThrow(cwd, ['clean', '-fd'])
    return { discarded: 'all' as const }
  }

  for (const path of paths) {
    const tracked = git(cwd, ['ls-files', '--error-unmatch', '--', path]).ok
    if (tracked) {
      git(cwd, ['restore', '--staged', '--worktree', '--', path])
    } else {
      git(cwd, ['clean', '-fd', '--', path])
    }
  }
  return { discarded: paths.length }
}

const GH_STATUS_TTL_MS = 60_000
let ghStatusCache: { at: number; value: { installed: boolean; authenticated: boolean } } | null =
  null

/** Whether the `gh` CLI is installed and authenticated (cached ~60s). */
export function ghStatus(): { installed: boolean; authenticated: boolean } {
  const now = Date.now()
  if (ghStatusCache && now - ghStatusCache.at < GH_STATUS_TTL_MS) {
    return ghStatusCache.value
  }
  try {
    ensureProcessPathAugmented()
    if (!findOnPath('gh')) {
      const value = { installed: false, authenticated: false }
      ghStatusCache = { at: now, value }
      return value
    }
    const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' })
    const value = { installed: true, authenticated: auth.status === 0 }
    ghStatusCache = { at: now, value }
    return value
  } catch {
    const value = { installed: false, authenticated: false }
    ghStatusCache = { at: now, value }
    return value
  }
}

/** Open a pull request with the gh CLI. Returns the PR URL it prints. */
export function createPullRequest(input: {
  cwd: string
  title: string
  body: string
  base?: string
}): { url: string } {
  const { cwd, title, body, base } = input
  if (!isRepo(cwd)) throw new Error('Not a git repository')

  const info = repoInfo(cwd)
  if (!info.remote) throw new Error(missingOriginRemoteMessage())

  const gh = ghStatus()
  if (!gh.installed) throw new Error(ghNotInstalledMessage())
  if (!gh.authenticated) throw new Error(ghNotAuthenticatedMessage())

  const args = ['pr', 'create', '--title', title, '--body', body]
  if (base) args.push('--base', base)

  const res = spawnSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (res.status !== 0) throw new Error(out.trim() || 'gh pr create failed')

  const url = out.match(/https:\/\/\S+/)?.[0] ?? ''
  return { url }
}

// ---------------------------------------------------------------------------
// Worktrees & repo acquisition
// ---------------------------------------------------------------------------

export type WorktreeEntry = { path: string; branch: string; head: string; bare: boolean }

/** Parse `git worktree list --porcelain`; empty when the command fails (e.g. path not a repo). */
export function listWorktrees(repoPath: string): WorktreeEntry[] {
  const res = git(repoPath, ['worktree', 'list', '--porcelain'])
  if (!res.ok) return []

  const entries: WorktreeEntry[] = []
  // Records are blank-line separated; each line is `<key>[ <value>]`.
  let current: Partial<WorktreeEntry> | null = null
  const flush = () => {
    if (current?.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? '',
        head: current.head ?? '',
        bare: current.bare ?? false,
      })
    }
    current = null
  }
  for (const line of res.stdout.split('\n')) {
    if (line === '') {
      flush()
      continue
    }
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'worktree') {
      current = { path: value }
    } else if (key === 'HEAD') {
      if (current) current.head = value
    } else if (key === 'branch') {
      if (current) current.branch = value.replace(/^refs\/heads\//, '')
    } else if (key === 'bare' || key === 'detached') {
      if (current && key === 'bare') current.bare = true
    }
  }
  flush()
  return entries
}

/**
 * Add a worktree. `newBranch` creates it off `baseRef`; otherwise `branch` must
 * already exist. Uses gitOrThrow because git refuses to check out a branch that
 * is already checked out in another worktree — that error must reach the user.
 */
export function addWorktree(input: {
  repoPath: string
  branch: string
  path: string
  baseRef: string
  newBranch: boolean
}): void {
  const { repoPath, branch, path, baseRef, newBranch } = input
  if (newBranch) {
    gitOrThrow(repoPath, ['worktree', 'add', '-b', branch, path, baseRef])
  } else {
    gitOrThrow(repoPath, ['worktree', 'add', path, branch])
  }
}

/** Remove a worktree, then prune stale metadata. Prune failure is not fatal. */
export function removeWorktree(repoPath: string, path: string, force: boolean): void {
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), path]
  gitOrThrow(repoPath, args)
  git(repoPath, ['worktree', 'prune'])
}

/**
 * Clone a repo. No cwd repo exists yet, so this shells out directly rather than
 * via `git()`. GIT_TERMINAL_PROMPT=0 (with GIT_ASKPASS cleared) makes a missing
 * credential fail fast instead of hanging forever on an invisible password
 * prompt from a headless server process.
 */
export function cloneRepo(input: { url: string; dest: string }): void {
  const res = spawnSync('git', ['clone', input.url, input.dest], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' },
  })
  if (res.status !== 0) {
    throw new Error(gitErrorMessage(res.stderr ?? '', 'git clone failed'))
  }
}

/**
 * Turn an existing empty directory into a repo. No cwd repo exists yet, so the
 * init itself shells out directly rather than via `git()`.
 *
 * The empty initial commit is what gives run diffs a base to compare against —
 * a repo on an unborn branch has no HEAD, so every snapshot/diff path reports
 * nothing until the first commit. It is best-effort: it fails when the user has
 * no git identity configured, which registering the project does not require.
 */
export function initRepo(dir: string): void {
  const res = spawnSync('git', ['init'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    env: gitEnv(),
  })
  if (res.status !== 0) {
    throw new Error(gitErrorMessage(res.stderr ?? '', 'git init failed'))
  }
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(dir, ['commit', '--allow-empty', '-m', 'Initial commit'])
}

/** Best-effort default branch: origin's HEAD, then current branch, then 'main'. */
export function detectDefaultBranch(repoPath: string): string {
  const symbolic = git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (symbolic.ok) {
    const name = symbolic.stdout.trim().replace(/^origin\//, '')
    if (name) return name
  }
  const current = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (current.ok && current.stdout.trim()) return current.stdout.trim()
  return 'main'
}

export function listRecentBranches(repoPath: string, limit?: number): GitBranchRow[] {
  const res = git(repoPath, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(committerdate:unix)%09%(refname)%09%(HEAD)',
    'refs/heads',
    'refs/remotes',
  ])
  if (!res.ok) return []
  return parseGitForEachRef(res.stdout, limit)
}

export function remoteUrl(repoPath: string): string {
  const res = git(repoPath, ['remote', 'get-url', 'origin'])
  return res.ok ? res.stdout.trim() : ''
}

/** Used to guard workspace archive — refuse to discard work that isn't on the remote. */
export function hasUnpushedWork(repoPath: string): { dirty: boolean; ahead: number } {
  const info = repoInfo(repoPath)
  return { dirty: info.dirty, ahead: info.ahead }
}
