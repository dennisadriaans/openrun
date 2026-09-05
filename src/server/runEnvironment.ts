/**
 * One isolated filesystem per automation invocation. No workspace rows are
 * created here. The journal precedes Git creation; the marker in Git's private
 * worktree directory proves ownership. Unknown or dirty directories are kept.
 * Results are pinned with refs before removal, including detached commits.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getDb, openrunHome, type TaskRow } from './db.ts'
import * as git from './git.ts'
import type { RunCommitSummary } from '../lib/undoRun.ts'
import type { FileContent, FileEntry } from './files.ts'
import { isPidAlive, isWorkspaceCancellationPending } from './processControl.ts'

export type RunEnvironment = {
  runId: string
  projectId: string
  repoPath: string
  path: string
  baseRef: string
  baseCommit: string
  branch: string
  gitDir: string
  state: 'creating' | 'retained' | 'released'
  resultCommit: string
  resultView: string
  note: string
  setupLog: string
  setupArtifacts: string
  createdAt: number
}

const processState = globalThis as unknown as { __openrunEnvironmentLeases?: Map<string, number> }
function leases() {
  if (!processState.__openrunEnvironmentLeases)
    processState.__openrunEnvironmentLeases = new Map<string, number>()
  return processState.__openrunEnvironmentLeases
}

/** Protect filesystem use across async Git/check/setup operations and HMR. */
export function holdRunEnvironment(runId: string): () => void {
  leases().set(runId, (leases().get(runId) ?? 0) + 1)
  return () => {
    const count = (leases().get(runId) ?? 1) - 1
    if (count) leases().set(runId, count)
    else leases().delete(runId)
  }
}

export async function usingRunEnvironment<T>(runId: string, action: () => Promise<T>): Promise<T> {
  const release = holdRunEnvironment(runId)
  try {
    ensureRunEnvironment(runId)
    return await action()
  } finally {
    release()
    releaseRunEnvironment(runId)
  }
}

function command(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function getRunEnvironment(runId: string): RunEnvironment | undefined {
  return getDb().prepare('SELECT * FROM run_environments WHERE runId = ?').get(runId) as
    | RunEnvironment
    | undefined
}

export function automationBase(workspaceId: string, requested?: string) {
  const project = getDb()
    .prepare(`SELECT p.* FROM projects p JOIN workspaces w ON w.projectId = p.id WHERE w.id = ?`)
    .get(workspaceId) as
    | { id: string; path: string; defaultBranch: string; setupCommand: string }
    | undefined
  if (!project || !existsSync(project.path) || !git.isRepo(project.path)) {
    throw new Error('The project repository is unavailable. Check its folder in Projects.')
  }
  const baseRef = requested?.trim() || project.defaultBranch
  if (!baseRef || baseRef.startsWith('-') || baseRef.includes('\0'))
    throw new Error('Choose a valid automation base branch or revision.')
  // Use the locally known remote-tracking revision where available. No pull,
  // stash, checkout or network-dependent fallback touches the developer tree.
  const remote = git.resolveCommit(project.path, `refs/remotes/origin/${baseRef}`)
  const commit =
    remote ||
    command(project.path, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${baseRef}^{commit}`,
    ]).trim()
  if (!commit) throw new Error(`Cannot resolve automation base "${baseRef}".`)
  return { project, baseRef, commit }
}

export function automationBaseRefusal(workspaceId: string, baseRef?: string): string | null {
  try {
    automationBase(workspaceId, baseRef)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

export function createRunEnvironment(
  runId: string,
  workspaceId: string,
  baseRef?: string,
): RunEnvironment {
  if (!/^run_[a-zA-Z0-9]+$/.test(runId)) throw new Error('Invalid run identity')
  const base = automationBase(workspaceId, baseRef)
  const path = join(resolve(openrunHome()), 'executions', runId)
  if (existsSync(path))
    throw new Error('Execution directory already exists; it has been preserved.')
  getDb()
    .prepare(`INSERT INTO run_environments (runId, projectId, repoPath, path, baseRef, baseCommit, branch, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      runId,
      base.project.id,
      realpathSync(base.project.path),
      path,
      base.baseRef,
      base.commit,
      `openrun/${runId}`,
      Date.now(),
    )
  const env = getRunEnvironment(runId)!
  mkdirSync(dirname(path), { recursive: true })
  git.addWorktree({
    repoPath: env.repoPath,
    path,
    branch: env.branch,
    baseRef: env.baseCommit,
    newBranch: true,
  })
  markOwned(env)
  command(env.repoPath, ['update-ref', `refs/openrun/${runId}/base`, env.baseCommit])
  return getRunEnvironment(runId)!
}

function markOwned(env: RunEnvironment): void {
  const gitDir = realpathSync(command(env.path, ['rev-parse', '--absolute-git-dir']).trim())
  writeFileSync(join(gitDir, 'openrun-owner'), env.runId, { flag: 'wx', mode: 0o600 })
  getDb()
    .prepare(
      "UPDATE run_environments SET gitDir = ?, state = 'retained', note = '' WHERE runId = ?",
    )
    .run(gitDir, env.runId)
}

// Only known build/dependency directories created by setup can be disposable.
// .env, agent output and arbitrary ignored files always remain recoverable.
const SETUP_ARTIFACTS = ['node_modules', '.venv', 'dist', 'build', '.cache']
function artifactFingerprint(path: string): string {
  const hash = createHash('sha256')
  const visit = (file: string) => {
    const stat = lstatSync(file, { bigint: true })
    hash.update(
      JSON.stringify([
        file,
        String(stat.dev),
        String(stat.ino),
        String(stat.mode),
        String(stat.size),
        String(stat.mtimeNs),
        String(stat.ctimeNs),
      ]),
    )
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) visit(join(file, name))
  }
  visit(path)
  return hash.digest('hex')
}

/** Record only ignored artifacts produced by this run's setup, before the agent. */
export function recordSetupArtifacts(runId: string): void {
  const env = getRunEnvironment(runId)!
  const artifacts: Record<string, string> = {}
  for (const name of SETUP_ARTIFACTS) {
    const file = join(env.path, name)
    if (!existsSync(file) || !lstatSync(file).isDirectory()) continue
    if (command(env.path, ['ls-files', '--', name]).trim()) continue
    const ignored = spawnSync('git', ['check-ignore', '-q', '--', name], { cwd: env.path })
    if (ignored.status === 0) artifacts[name] = artifactFingerprint(file)
  }
  getDb()
    .prepare('UPDATE run_environments SET setupArtifacts = ? WHERE runId = ?')
    .run(JSON.stringify(artifacts), runId)
}

function owns(env: RunEnvironment): boolean {
  try {
    if (resolve(env.path) !== join(resolve(openrunHome()), 'executions', env.runId)) return false
    if (lstatSync(env.path).isSymbolicLink()) return false
    if (
      !git.listWorktrees(env.repoPath).some((e) => realpathSync(e.path) === realpathSync(env.path))
    )
      return false
    const gitDir = realpathSync(command(env.path, ['rev-parse', '--absolute-git-dir']).trim())
    return (
      gitDir === env.gitDir && readFileSync(join(gitDir, 'openrun-owner'), 'utf8') === env.runId
    )
  } catch {
    return false
  }
}

export function assertOwnedEnvironment(runId: string): void {
  const env = getRunEnvironment(runId)
  if (env && !owns(env))
    throw new Error('Execution ownership could not be verified. The directory has been preserved.')
}

/** Never remove branches, force removal, prune another worktree, or discard files. */
export function releaseRunEnvironment(runId: string): void {
  const env = getRunEnvironment(runId)
  if (!env || env.state === 'released' || leases().has(runId)) return
  const run = getDb()
    .prepare('SELECT status, pid, workspaceId FROM runs WHERE id = ?')
    .get(runId) as { status: string; pid: number | null; workspaceId: string } | undefined
  if (run?.status === 'running' || isPidAlive(run?.pid) || isWorkspaceCancellationPending(runId))
    return
  if (getDb().prepare("SELECT id FROM runs WHERE cwd = ? AND status = 'running'").get(env.path))
    return
  const retain = (note: string) =>
    getDb().prepare('UPDATE run_environments SET note = ? WHERE runId = ?').run(note, runId)
  if (!existsSync(env.path)) {
    // A crash after remove but before the journal update is recoverable.
    if (env.resultCommit && env.resultView)
      getDb()
        .prepare("UPDATE run_environments SET state = 'released', note = '' WHERE runId = ?")
        .run(runId)
    else retain('Directory missing; creation journal and Git refs retained for recovery.')
    return
  }
  if (!owns(env)) {
    retain('Ownership could not be verified; directory retained.')
    return
  }
  try {
    if (existsSync(join(env.gitDir, 'locked'))) {
      retain('Worktree is locked; retained.')
      return
    }
    // Include ignored files: .env and other user data must never disappear as
    // a side effect of Git considering a worktree clean.
    const status = command(env.path, [
      'status',
      '--porcelain',
      '--untracked-files=all',
      '--ignored',
    ])
    const artifacts = JSON.parse(env.setupArtifacts || '{}') as Record<string, string>
    const disposable = Object.keys(artifacts).filter(
      (name) =>
        SETUP_ARTIFACTS.includes(name) &&
        existsSync(join(env.path, name)) &&
        artifactFingerprint(join(env.path, name)) === artifacts[name],
    )
    const changes = command(env.path, [
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=all',
      '--ignored',
    ])
      .split('\0')
      .filter(Boolean)
    if (
      status.trim() &&
      changes.some(
        (line) =>
          !line.startsWith('!! ') ||
          !disposable.some(
            (name) => line.slice(3) === `${name}/` || line.slice(3).startsWith(`${name}/`),
          ),
      )
    ) {
      retain('Local files retained for recovery (uncommitted, untracked or ignored files).')
      return
    }
    // A terminal app run does not prove an external terminal/editor has left.
    // If the platform cannot establish this, retain the directory.
    const users = spawnSync('lsof', ['-t', '+D', env.path], { encoding: 'utf8', timeout: 10_000 })
    if (users.error || users.status !== 1 || users.stdout.trim() || users.stderr.trim()) {
      retain('Execution directory may still be in use; retained until it is idle.')
      return
    }
    const resultCommit = command(env.path, ['rev-parse', '--verify', 'HEAD']).trim()
    command(env.repoPath, ['update-ref', `refs/openrun/${runId}/result`, resultCommit])
    const resultView = JSON.stringify({
      files: git.changedFiles(env.path, env.baseCommit),
      repo: git.repoInfo(env.path),
      commits: git.runCommits(env.path, env.baseCommit),
    })
    const branch = git.currentBranch(env.path)
    getDb()
      .prepare(
        'UPDATE run_environments SET resultCommit = ?, resultView = ?, branch = ? WHERE runId = ?',
      )
      .run(resultCommit, resultView, branch === 'HEAD' ? '' : branch, runId)
    // The metadata fingerprint includes inode and ctime: any edits or new
    // files since setup prevent deletion. Paths come from a fixed allowlist.
    for (const name of disposable) {
      if (artifactFingerprint(join(env.path, name)) !== artifacts[name])
        throw new Error('Setup artifacts changed during cleanup')
      rmSync(join(env.path, name), { recursive: true })
    }
    // Git itself refuses locked worktrees and new dirt; no --force escape.
    command(env.repoPath, ['worktree', 'remove', env.path])
    getDb()
      .prepare("UPDATE run_environments SET state = 'released', note = '' WHERE runId = ?")
      .run(runId)
  } catch (err) {
    retain(`Directory retained: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Called before scheduler boot and periodically; journaled resources only. */
export function collectRunEnvironments(): void {
  for (const env of getDb()
    .prepare("SELECT runId FROM run_environments WHERE state != 'released'")
    .all() as Array<{ runId: string }>)
    releaseRunEnvironment(env.runId)
}

/** Explicit continuation/mutation only. Reading history never recreates a tree. */
export function ensureRunEnvironment(runId: string): boolean {
  const env = getRunEnvironment(runId)
  if (!env) return false
  if (env.state !== 'released') {
    assertOwnedEnvironment(runId)
    return false
  }
  if (existsSync(env.path))
    throw new Error('The execution path is occupied. Its contents have been preserved.')
  let branch = env.branch
  // Another checkout or a user may have moved the old branch after release.
  // Preserve it and resume our pinned result on a fresh branch in that case.
  const reusable =
    branch &&
    git.resolveCommit(env.repoPath, `refs/heads/${branch}`) === env.resultCommit &&
    !git.listWorktrees(env.repoPath).some((e) => e.branch === branch)
  if (!reusable) branch = `openrun/${runId}/resume-${randomUUID().slice(0, 8)}`
  getDb().prepare("UPDATE run_environments SET state = 'creating' WHERE runId = ?").run(runId)
  git.addWorktree({
    repoPath: env.repoPath,
    path: env.path,
    branch,
    baseRef: env.resultCommit,
    newBranch: !reusable,
  })
  markOwned(env)
  getDb().prepare('UPDATE run_environments SET branch = ? WHERE runId = ?').run(branch, runId)
  getDb().prepare('UPDATE runs SET headBranch = ? WHERE id = ?').run(branch, runId)
  return true
}

export function releasedResult(runId: string) {
  const env = getRunEnvironment(runId)
  if (env?.state !== 'released' || !env.resultView) return null
  const view = JSON.parse(env.resultView) as {
    files: git.DiffFile[]
    repo: git.RepoInfo
    commits: RunCommitSummary
  }
  return { env, ...view }
}

function safeTreePath(path: string): string {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((p) => p === '..' || p === '.git')
  )
    throw new Error('Path escapes the run result')
  return path.replace(/\/$/, '')
}

export function resultFileDiff(env: RunEnvironment, path: string, context: number = 3): string {
  return command(env.repoPath, [
    '--literal-pathspecs',
    'diff',
    `-U${context}`,
    env.baseCommit,
    env.resultCommit,
    '--',
    safeTreePath(path),
  ])
}

export function resultDirectory(env: RunEnvironment, dir: string): FileEntry[] {
  const prefix = safeTreePath(dir)
  const tree = prefix ? `${env.resultCommit}:${prefix}` : env.resultCommit
  return command(env.repoPath, ['ls-tree', '-z', '-l', tree])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+ (\w+) \w+\s+(\d+|-)\t([\s\S]+)$/)
      if (!match) throw new Error('Cannot read the run result tree')
      const [, type, size, name] = match
      return {
        name: name!,
        path: prefix ? `${prefix}/${name}` : name!,
        kind: type === 'tree' ? ('directory' as const) : ('file' as const),
        size: Number(size) || 0,
      }
    })
}

export function resultFile(env: RunEnvironment, path: string): FileContent {
  const safe = safeTreePath(path)
  const ref = `${env.resultCommit}:${safe}`
  const size = Number(command(env.repoPath, ['cat-file', '-s', ref]))
  if (size > 2 * 1024 * 1024)
    return {
      path: safe,
      size,
      content: '',
      readOnly: true,
      reason: 'File is too large to display.',
    }
  const content = command(env.repoPath, ['cat-file', 'blob', ref])
  const binary = content.includes('\0')
  return {
    path: safe,
    size,
    content: binary ? '' : content,
    readOnly: binary,
    ...(binary ? { reason: 'Binary file' } : {}),
  }
}

/** Legacy automation targets become project links; no directory is deleted. */
export function migrateAutomationTargets(): void {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT t.*, w.projectId, w.baseCommit AS legacyBase FROM tasks t JOIN workspaces w ON w.id = t.workspaceId WHERE w.kind = 'worktree'`,
    )
    .all() as Array<TaskRow & { projectId: string; legacyBase: string }>
  for (const task of rows) {
    const main = db
      .prepare(
        "SELECT id, path FROM workspaces WHERE projectId = ? AND kind = 'main' AND status = 'ready' LIMIT 1",
      )
      .get(task.projectId) as { id: string; path: string } | undefined
    if (!main) continue
    // Persist the known original base, never the previous run's branch tip.
    const fallback = db
      .prepare('SELECT defaultBranch FROM projects WHERE id = ?')
      .get(task.projectId) as { defaultBranch: string } | undefined
    const base = task.baseRef || task.legacyBase || fallback?.defaultBranch
    if (!base || automationBaseRefusal(main.id, base)) continue
    db.prepare(
      'UPDATE tasks SET workspaceId = ?, cwd = ?, baseRef = ?, requireIsolation = 1 WHERE id = ?',
    ).run(main.id, main.path, base, task.id)
  }
}
