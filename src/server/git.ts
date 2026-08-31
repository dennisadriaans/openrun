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
import { spawn, spawnSync } from 'node:child_process'
import { ensureProcessPathAugmented, findOnPath } from './userPath.ts'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractHunkPatch, parseUnifiedDiff } from '../lib/diff.ts'
import {
  ghNotAuthenticatedMessage,
  ghNotInstalledMessage,
  missingOriginRemoteMessage,
} from '../lib/gitActionGate.ts'
import { parseGitForEachRef, type GitBranchRow } from '../lib/gitBranches.ts'
import { parseGhPullRequestListResult, type RunPullRequest } from '../lib/pullRequest.ts'
import {
  NO_RUN_COMMITS,
  undoCommitsBlockedReason,
  type RunCommit,
  type RunCommitSummary,
} from '../lib/undoRun.ts'

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

/** Reject strings that git would treat as options rather than values. */
function refuseLeadingDash(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  if (trimmed.startsWith('-') || trimmed.includes('\0')) {
    throw new Error(`Invalid ${label}`)
  }
  return trimmed
}

function gitEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...extra }
}

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const res = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
      env: env ?? gitEnv(),
      input,
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

function gitAsync(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', args, {
        cwd,
        env: env ?? gitEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      if (input != null) child.stdin.write(input)
      child.stdin.end()
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > MAX_BUFFER) child.kill('SIGTERM')
      })
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', (err) => {
        resolve({ ok: false, stdout: '', stderr: String(err) })
      })
      child.on('close', (code) => {
        resolve({ ok: code === 0, stdout, stderr })
      })
    } catch (err) {
      resolve({ ok: false, stdout: '', stderr: String(err) })
    }
  })
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

/** Resolve a ref to a full commit SHA, or return empty when it is unavailable. */
export function resolveCommit(cwd: string, ref: string): string {
  if (!ref.trim()) return ''
  const result = git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return result.ok ? result.stdout.trim() : ''
}

/** Find the common ancestor of HEAD and a base ref, or return empty. */
export function mergeBase(cwd: string, ref: string): string {
  if (!ref.trim()) return ''
  const result = git(cwd, ['merge-base', 'HEAD', ref])
  return result.ok ? result.stdout.trim() : ''
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

export async function repoInfoAsync(cwd: string): Promise<RepoInfo> {
  const empty: RepoInfo = {
    isRepo: false,
    branch: '',
    head: '',
    remote: '',
    hasUpstream: false,
    ahead: 0,
    dirty: false,
  }
  const inside = await gitAsync(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() !== 'true') return empty

  const [branchRes, headRes, remoteRes, upstream] = await Promise.all([
    gitAsync(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitAsync(cwd, ['rev-parse', '--short', 'HEAD']),
    gitAsync(cwd, ['remote', 'get-url', 'origin']),
    gitAsync(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
  ])
  const hasUpstream = upstream.ok && upstream.stdout.trim().length > 0
  let ahead = 0
  if (hasUpstream) {
    const counts = await gitAsync(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    ahead = Number(counts.stdout.trim().split(/\s+/)[1] ?? 0) || 0
  }
  const dirtyRes = await gitAsync(cwd, ['status', '--porcelain'])
  return {
    isRepo: true,
    branch: branchRes.stdout.trim(),
    head: headRes.stdout.trim(),
    remote: remoteRes.stdout.trim(),
    hasUpstream,
    ahead,
    dirty: dirtyRes.stdout.trim().length > 0,
  }
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
  const stat = git(cwd, ['diff', '--no-index', '--numstat', '--', '/dev/null', path]).stdout
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

/** Field separator inside one `git log --format` record; never appears in a subject. */
const LOG_SEP = '\x1f'

function parseRunCommitLog(stdout: string): RunCommit[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split(LOG_SEP)
      return { sha, subject }
    })
    .filter((c) => c.sha.length > 0)
}

/**
 * The commit the branch pointed at when the run started, or '' when nothing
 * safe to reset to remains.
 *
 * `captureBaseSnapshot` writes a dangling commit whose *parent* is that HEAD,
 * so the snapshot itself must never become a reset target — it carries the
 * working tree as its tree. When capture fell back to HEAD (clean tree, or a
 * failure) the snapshot is already the commit we want, which is exactly the
 * case where it is reachable from HEAD.
 *
 * A base that is no longer an ancestor of HEAD means the history moved under
 * us — a rebase, an amend, a reset by hand. Resetting to it then would throw
 * away work this run never made, so we report nothing instead.
 */
function runBaseCommit(cwd: string, baseSnapshot: string): string {
  const base = baseSnapshot.trim()
  if (!base) return ''
  if (!git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) return ''

  const candidate = git(cwd, ['merge-base', '--is-ancestor', base, 'HEAD']).ok
    ? base
    : git(cwd, ['rev-parse', '--verify', '--quiet', `${base}^`]).stdout.trim()

  if (!candidate) return ''
  return git(cwd, ['merge-base', '--is-ancestor', candidate, 'HEAD']).ok ? candidate : ''
}

/**
 * Commits made during the run, and how many of them a remote already has.
 *
 * `--not --remotes` is the cheap form of "which of these has never left this
 * machine": anything reachable from a remote-tracking ref drops out, so the
 * remainder is what a reset could drop without rewriting published history.
 */
export function runCommits(cwd: string, baseSnapshot: string): RunCommitSummary {
  if (!isRepo(cwd)) return NO_RUN_COMMITS

  const baseCommit = runBaseCommit(cwd, baseSnapshot)
  if (!baseCommit) return NO_RUN_COMMITS

  const log = git(cwd, ['log', `--format=%H${LOG_SEP}%s`, `${baseCommit}..HEAD`])
  const commits = log.ok ? parseRunCommitLog(log.stdout) : []
  if (commits.length === 0) return { baseCommit, commits: [], published: 0 }

  const unpublished = git(cwd, ['rev-list', '--count', `${baseCommit}..HEAD`, '--not', '--remotes'])
  const local = unpublished.ok ? Number(unpublished.stdout.trim()) || 0 : commits.length
  return { baseCommit, commits, published: Math.max(0, commits.length - local) }
}

/** Async twin of {@link runCommits} for the read path. */
export async function runCommitsAsync(
  cwd: string,
  baseSnapshot: string,
): Promise<RunCommitSummary> {
  const inside = await gitAsync(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() !== 'true') return NO_RUN_COMMITS

  const base = baseSnapshot.trim()
  if (!base) return NO_RUN_COMMITS
  if (!(await gitAsync(cwd, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])).ok) {
    return NO_RUN_COMMITS
  }

  const snapshotOnBranch = await gitAsync(cwd, ['merge-base', '--is-ancestor', base, 'HEAD'])
  const candidate = snapshotOnBranch.ok
    ? base
    : (await gitAsync(cwd, ['rev-parse', '--verify', '--quiet', `${base}^`])).stdout.trim()
  if (!candidate) return NO_RUN_COMMITS
  if (!(await gitAsync(cwd, ['merge-base', '--is-ancestor', candidate, 'HEAD'])).ok) {
    return NO_RUN_COMMITS
  }

  const [log, unpublished] = await Promise.all([
    gitAsync(cwd, ['log', `--format=%H${LOG_SEP}%s`, `${candidate}..HEAD`]),
    gitAsync(cwd, ['rev-list', '--count', `${candidate}..HEAD`, '--not', '--remotes']),
  ])
  const commits = log.ok ? parseRunCommitLog(log.stdout) : []
  if (commits.length === 0) return { baseCommit: candidate, commits: [], published: 0 }

  const local = unpublished.ok ? Number(unpublished.stdout.trim()) || 0 : commits.length
  return { baseCommit: candidate, commits, published: Math.max(0, commits.length - local) }
}

/**
 * Move the branch back to where the run found it, keeping the working tree.
 *
 * `--mixed` rather than `--hard` on purpose: the caller has already restored
 * every file to the base snapshot, and that snapshot includes changes the user
 * had in flight *before* the run. A hard reset would take those with it.
 * Afterwards the branch is back, the index is clean, and anything the user was
 * mid-edit on is still sitting in the worktree as unstaged work.
 *
 * The dropped commits stay in the reflog; `previousHead` is what you hand
 * someone who wants them back.
 */
export function resetRunCommits(
  cwd: string,
  baseSnapshot: string,
): { baseCommit: string; previousHead: string; dropped: number } {
  if (!isRepo(cwd)) throw new Error('Not a git repository')

  const summary = runCommits(cwd, baseSnapshot)
  const blocked = undoCommitsBlockedReason(summary)
  if (blocked) throw new Error(blocked)

  const previousHead = git(cwd, ['rev-parse', 'HEAD']).stdout.trim()
  gitOrThrow(cwd, ['reset', '--mixed', summary.baseCommit])
  return { baseCommit: summary.baseCommit, previousHead, dropped: summary.commits.length }
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

export async function changedFilesAsync(cwd: string, since?: string): Promise<DiffFile[]> {
  const inside = await gitAsync(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.stdout.trim() !== 'true') return []

  const base = since && since.length > 0 ? since : 'HEAD'
  const files = new Map<string, DiffFile>()

  const [nameStatusRes, numstatRes, untrackedRes] = await Promise.all([
    gitAsync(cwd, ['diff', base, '--name-status', '-M', '-z']),
    gitAsync(cwd, ['diff', base, '--numstat', '-M', '-z']),
    gitAsync(cwd, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])

  const parts = nameStatusRes.stdout.split('\0').filter((p) => p.length > 0)
  const pendingHash: string[] = []
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
      if (code.includes('D') && existsSync(join(cwd, path))) {
        pendingHash.push(path)
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

  await Promise.all(
    pendingHash.map(async (path) => {
      const [prev, cur] = await Promise.all([
        gitAsync(cwd, ['rev-parse', `${base}:${path}`]),
        gitAsync(cwd, ['hash-object', '--', path]),
      ])
      const prevHash = prev.ok ? prev.stdout.trim() : ''
      const curHash = cur.ok ? cur.stdout.trim() : ''
      if (prevHash && curHash && prevHash === curHash) return
      files.set(path, {
        path,
        oldPath: null,
        status: 'modified',
        additions: 0,
        deletions: 0,
        binary: false,
      })
    }),
  )

  const nparts = numstatRes.stdout.split('\0').filter((p) => p.length > 0)
  for (let i = 0; i < nparts.length; i++) {
    const line = nparts[i]!
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (!m) continue
    const [, addRaw, delRaw, tail] = m
    let path = tail!
    if (path === '') {
      i++
      path = nparts[++i] ?? ''
    }
    const entry = files.get(path)
    if (!entry) continue
    entry.binary = addRaw === '-' || delRaw === '-'
    entry.additions = entry.binary ? 0 : Number(addRaw)
    entry.deletions = entry.binary ? 0 : Number(delRaw)
  }

  const untrackedPaths = untrackedRes.stdout.split('\0').filter((p) => p.length > 0)
  await Promise.all(
    untrackedPaths.map(async (path) => {
      const statsRes = await gitAsync(cwd, [
        'diff',
        '--no-index',
        '--numstat',
        '--',
        '/dev/null',
        path,
      ])
      const statMatch = statsRes.stdout.match(/^(\d+|-)\t(\d+|-)\t/)
      const binary = statMatch ? statMatch[1] === '-' : false
      const additions = binary || !statMatch ? 0 : Number(statMatch[1])

      if (files.has(path)) {
        const entry = files.get(path)!
        entry.additions = additions
        entry.deletions = 0
        entry.binary = binary
        return
      }

      if (since && since.length > 0) {
        const inTree = await gitAsync(cwd, ['cat-file', '-e', `${base}:${path}`])
        if (inTree.ok) {
          const [prev, cur] = await Promise.all([
            gitAsync(cwd, ['rev-parse', `${base}:${path}`]),
            gitAsync(cwd, ['hash-object', '--', path]),
          ])
          const prevHash = prev.ok ? prev.stdout.trim() : ''
          const curHash = cur.ok ? cur.stdout.trim() : ''
          if (prevHash && curHash && prevHash === curHash) return
          files.set(path, {
            path,
            oldPath: null,
            status: 'modified',
            additions,
            deletions: 0,
            binary,
          })
          return
        }
      }

      files.set(path, {
        path,
        oldPath: null,
        status: 'untracked',
        additions,
        deletions: 0,
        binary,
      })
    }),
  )

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

/** Put a registered worktree on its configured branch at its immutable base. */
export function resetWorktree(cwd: string, branch: string, baseCommit: string): void {
  if (!isRepo(cwd)) throw new Error('Not a git repository')
  if (!branch.trim()) throw new Error('A branch is required to restore a worktree')
  if (!resolveCommit(cwd, baseCommit)) {
    throw new Error('The workspace restore base commit is unavailable')
  }

  // Reset before checkout: a dirty tree makes `git checkout` refuse when the
  // branches differ in the files that are dirty.
  gitOrThrow(cwd, ['reset', '--hard'])
  // No -x: ignored files are the worktree's installed dependencies, .env and
  // build caches. Removing those turns a restore into a re-setup.
  gitOrThrow(cwd, ['clean', '-fd'])

  if (currentBranch(cwd) !== branch) {
    gitOrThrow(cwd, ['checkout', branch])
  }

  gitOrThrow(cwd, ['reset', '--hard', baseCommit])
}

/** Create and switch to a new branch. */
export function createBranch(cwd: string, name: string) {
  const branch = refuseLeadingDash(name, 'branch name')
  // `-b` consumes the next argv as the name, so `--` cannot sit between them.
  gitOrThrow(cwd, ['checkout', '-b', branch])
  return { branch }
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

/**
 * Reverse one hunk of the run delta, like `git apply -R` on a `git log -p`
 * slice. A file whose remaining diff is a single hunk is restored wholesale.
 */
export function discardHunk(
  cwd: string,
  path: string,
  hunkIndex: number,
  since?: string,
): { discarded: number } {
  if (!isRepo(cwd)) throw new Error('Not a git repository')
  if (!Number.isInteger(hunkIndex) || hunkIndex < 0) {
    throw new Error('That change is no longer in the diff')
  }

  const diff = fileDiff(cwd, path, since)
  const parsed = parseUnifiedDiff(diff)
  if (parsed.binary) throw new Error('Binary files can only be undone as a whole')
  if (hunkIndex >= parsed.hunks.length) {
    throw new Error('That change is no longer in the diff')
  }
  if (parsed.hunks.length === 1) {
    discard(cwd, [path], since)
    return { discarded: 1 }
  }

  const patch = extractHunkPatch(diff, hunkIndex)
  if (!patch) throw new Error('That change is no longer in the diff')

  const attempt = (args: string[]) => git(cwd, args, undefined, patch)
  const first = attempt(['apply', '-R', '--whitespace=nowarn', '--recount'])
  if (first.ok) return { discarded: 1 }

  const retry = attempt(['apply', '-R', '--whitespace=nowarn', '--unidiff-zero', '-C0'])
  if (!retry.ok) {
    throw new Error(gitErrorMessage(retry.stderr, 'Could not undo that change'))
  }
  return { discarded: 1 }
}

const GH_STATUS_TTL_MS = 60_000
/** Keep a broken gh/network from holding the run detail request forever. */
export const GH_PROBE_TIMEOUT_MS = 10_000
const GH_KILL_GRACE_MS = 250
const GH_CLOSE_FALLBACK_MS = 1_000
/** PR metadata is tiny; never let a broken CLI fill the run request's heap. */
const GH_MAX_BUFFER = 1 * 1024 * 1024
const GH_PR_FIELDS = 'number,url,title,state,isDraft,statusCheckRollup'

export type PullRequestProbeResult =
  | { kind: 'found'; pullRequest: RunPullRequest }
  | { kind: 'none' }
  | { kind: 'error'; reason: string }

type GhCommandResult = {
  status: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

export type GhCommandRunner = (
  cwd: string,
  args: string[],
  timeoutMs: number,
) => Promise<GhCommandResult>

export type PullRequestProbeOptions = {
  /** Test seam for deterministic gh outcomes; production uses a child process. */
  run?: GhCommandRunner
  /** Test seam for the cached auth check. */
  ghStatus?: () => Promise<{ installed: boolean; authenticated: boolean }>
  /** Test seam for repositories without creating a real git checkout. */
  isRepo?: (cwd: string) => boolean
  timeoutMs?: number
}

function runGhCommand(cwd: string, args: string[], timeoutMs: number): Promise<GhCommandResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn> | null = null
    let settled = false
    let closed = false
    let terminating = false
    let stdout = ''
    let stderr = ''
    let timeout: ReturnType<typeof setTimeout> | null = null
    let killTimer: ReturnType<typeof setTimeout> | null = null
    let closeFallbackTimer: ReturnType<typeof setTimeout> | null = null
    let pendingTermination: GhCommandResult | null = null

    const finish = (result: GhCommandResult) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      if (closeFallbackTimer) clearTimeout(closeFallbackTimer)
      resolve(result)
    }

    const terminate = (result: GhCommandResult) => {
      if (terminating || settled) return
      terminating = true
      pendingTermination = result
      if (!child || closed) return
      try {
        child.kill('SIGTERM')
      } catch {
        // The process may have exited between the close check and kill.
      }
      killTimer = setTimeout(() => {
        if (closed || !child || settled) return
        try {
          child.kill('SIGKILL')
        } catch {
          // The process is already gone.
        }
        // Node normally emits `close` after SIGKILL. Keep a bounded fallback
        // for a broken child/stdio implementation, but never resolve before
        // SIGKILL has been attempted.
        closeFallbackTimer = setTimeout(() => {
          if (closed || settled) return
          finish(pendingTermination ?? { status: null, stdout, stderr })
        }, GH_CLOSE_FALLBACK_MS)
      }, GH_KILL_GRACE_MS)
    }

    try {
      child = spawn('gh', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        if (settled || terminating) return
        if (stdout.length + chunk.length > GH_MAX_BUFFER) {
          terminate({ status: null, stdout: '', stderr: 'gh returned too much output' })
          return
        }
        stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        if (settled || terminating) return
        if (stderr.length + chunk.length > GH_MAX_BUFFER) {
          terminate({ status: null, stdout: '', stderr: 'gh returned too much output' })
          return
        }
        stderr += chunk
      })
      child.on('error', (error) => {
        if (settled || terminating) return
        pendingTermination = { status: null, stdout, stderr: `${stderr}\n${String(error)}` }
      })
      child.on('close', (status) => {
        closed = true
        finish(
          pendingTermination ?? {
            status,
            stdout,
            stderr,
          },
        )
      })
      timeout = setTimeout(() => {
        terminate({ status: null, stdout, stderr, timedOut: true })
      }, timeoutMs)
    } catch (error) {
      finish({ status: null, stdout, stderr: `${stderr}\n${String(error)}` })
    }
  })
}
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
    const auth = spawnSync('gh', ['auth', 'status'], {
      encoding: 'utf8',
      maxBuffer: GH_MAX_BUFFER,
      timeout: GH_PROBE_TIMEOUT_MS,
      killSignal: 'SIGTERM',
    })
    const value = { installed: true, authenticated: auth.status === 0 }
    ghStatusCache = { at: now, value }
    return value
  } catch {
    const value = { installed: false, authenticated: false }
    ghStatusCache = { at: now, value }
    return value
  }
}

export async function ghStatusAsync(): Promise<{ installed: boolean; authenticated: boolean }> {
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
    const auth = await runGhCommand(process.cwd(), ['auth', 'status'], GH_PROBE_TIMEOUT_MS)
    const value = { installed: true, authenticated: auth.status === 0 && !auth.timedOut }
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

export type WorktreeListResult = {
  ok: boolean
  entries: WorktreeEntry[]
}

/** Parse `git worktree list --porcelain`; empty when the command fails (e.g. path not a repo). */
export function listWorktrees(repoPath: string): WorktreeEntry[] {
  return inspectWorktrees(repoPath).entries
}

/** Preserve command failure so reconciliation never treats it as an empty inventory. */
export function inspectWorktrees(repoPath: string): WorktreeListResult {
  const res = git(repoPath, ['worktree', 'list', '--porcelain'])
  if (!res.ok) return { ok: false, entries: [] }

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
  return { ok: true, entries }
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
  const { repoPath, newBranch } = input
  const branch = refuseLeadingDash(input.branch, 'branch name')
  const baseRef = refuseLeadingDash(input.baseRef, 'base ref')
  const path = input.path
  if (!path.trim()) throw new Error('Worktree path is required')
  if (path.startsWith('-') || path.includes('\0')) throw new Error('Invalid worktree path')
    gitOrThrow(repoPath, ['worktree', 'add', '-b', branch, '--', path, baseRef])
  } else {
    gitOrThrow(repoPath, ['worktree', 'add', '--', path, branch])
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
  const url = refuseLeadingDash(input.url, 'clone URL')
  const dest = refuseLeadingDash(input.dest, 'clone destination')
  const res = spawnSync('git', ['clone', '--', url, dest], {
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
export function hasUnpushedWork(repoPath: string): {
  dirty: boolean
  ahead: number
  branch: string
} {
  const info = repoInfo(repoPath)
  return { dirty: info.dirty, ahead: info.ahead, branch: info.branch }
}

/**
 * Look up a pull request by its persisted head branch.
 *
 * `gh pr list --state all` can still find merged/closed PRs after the local
 * branch is deleted, and unlike `gh pr view` it has an explicit no-result
 * response that does not require parsing localized error text.
 */
function ghErrorReason(output: GhCommandResult): string {
  if (output.timedOut) return 'gh pull request lookup timed out'
  const detail = `${output.stderr}\n${output.stdout}`.trim().replace(/\s+/g, ' ')
  if (!detail) return 'gh pull request lookup failed'
  const bounded = detail.length > 500 ? `${detail.slice(0, 500)}…` : detail
  return `gh pull request lookup failed: ${bounded}`
}

/** Look up a PR for the supplied branch without reading the mutable checkout HEAD. */
export async function pullRequestForBranchAsync(
  cwd: string,
  branch: string,
  options: PullRequestProbeOptions = {},
): Promise<PullRequestProbeResult> {
  const repo = options.isRepo ?? isRepo
  if (!repo(cwd)) return { kind: 'error', reason: 'the run workspace is not a git repository' }
  const named = branch.trim()
  if (!named || named === 'HEAD') {
    return { kind: 'error', reason: 'run has no named head branch' }
  }

  let gh: { installed: boolean; authenticated: boolean }
  try {
    gh = await (options.ghStatus ?? ghStatusAsync)()
  } catch {
    return { kind: 'error', reason: 'could not determine gh authentication status' }
  }
  if (!gh.installed) return { kind: 'error', reason: ghNotInstalledMessage() }
  if (!gh.authenticated) return { kind: 'error', reason: ghNotAuthenticatedMessage() }

  const run = options.run ?? runGhCommand
  let out: GhCommandResult
  try {
    out = await run(
      cwd,
      ['pr', 'list', '--head', named, '--state', 'all', '--limit', '1', '--json', GH_PR_FIELDS],
      options.timeoutMs ?? GH_PROBE_TIMEOUT_MS,
    )
  } catch {
    return { kind: 'error', reason: 'gh pull request lookup failed' }
  }
  if (out.status !== 0) {
    return { kind: 'error', reason: ghErrorReason(out) }
  }
  const parsed = parseGhPullRequestListResult(out.stdout)
  if (parsed.kind === 'none') return parsed
  return parsed.kind === 'found' ? parsed : { kind: 'error', reason: parsed.reason }
}
