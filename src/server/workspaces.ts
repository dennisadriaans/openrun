/** Project checkouts and legacy workspace compatibility metadata.
 * New automation execution directories belong to runs (runEnvironment.ts).
 * Never discover ownership from a Git worktree name or import the inventory.
 */
import { spawnSync } from 'node:child_process'
import { runCommand } from './command.ts'
import {
  SETUP_TIMEOUT_MS,
  commandOutputTooLargeMessage,
  commandTimedOutMessage,
} from '../lib/commandBudget.ts'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  assertChecks,
  parseChecks,
  serializeChecks,
  suggestChecksFromScripts,
  type CheckDef,
  type PackageRunner,
} from '../lib/checks'
import { assertFolderName } from '../lib/folderName'
import { assertWorkspaceReady } from '../lib/workspaceReady'
import { workspaceBusyMessage } from '../lib/startChatGate.ts'
import { missingWorkspaceDirMessage } from '../lib/workspaceHealth.ts'
import {
  openrunHome,
  forgetDeletedProjectPath,
  getDb,
  rememberDeletedProjectPath,
  slugify,
  type ProjectRow,
  type WorkspaceRow,
} from './db'
import * as git from './git'
import { isWorkspaceCancellationPending } from './processControl.ts'
import type { GitBranchRow } from '../lib/gitBranches.ts'

/**
 * Guess the verification checks for a freshly added repo from its
 * package.json scripts, so the common case needs no configuration — the user
 * reviews a suggestion on the project page instead of writing one from
 * scratch. Best-effort only: a repo we cannot read just starts with none.
 */
function detectProjectChecks(repoPath: string): string {
  try {
    const pkgPath = path.join(repoPath, 'package.json')
    if (!existsSync(pkgPath)) return '[]'
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, unknown> }
    const runner: PackageRunner = existsSync(path.join(repoPath, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(path.join(repoPath, 'bun.lockb'))
        ? 'bun'
        : existsSync(path.join(repoPath, 'yarn.lock'))
          ? 'yarn'
          : 'npm'
    return serializeChecks(suggestChecksFromScripts(pkg.scripts, runner))
  } catch {
    return '[]'
  }
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function canonicalPath(value: string): string {
  try {
    return realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}

export type ProjectWithMeta = ProjectRow & {
  /** Count of this project's workspaces excluding archived ones. */
  workspaceCount: number
  /** Whether the project's directory is still present on disk. */
  exists: boolean
}

export type WorkspaceWithMeta = WorkspaceRow & {
  projectName: string
  /** Branch stored when the workspace was created, before any manual drift. */
  configuredBranch: string
  /** Branch currently checked out on disk; empty when it cannot be inspected. */
  actualBranch: string
  /** Whether the recorded workspace directory still exists on disk. */
  exists: boolean
  dirty: boolean
  ahead: number
  /** id of a run with status='running' in this workspace, or null when free. */
  activeRunId: string | null
}

/**
 * Make Git's registered worktrees the workspace inventory source of truth.
 * Database rows only add setup, quarantine, and history metadata.
 */
export function reconcileWorkspaces(projectId?: string): void {
  const db = getDb()
  const projects = (
    projectId
      ? db.prepare('SELECT * FROM projects WHERE id = ?').all(projectId)
      : db.prepare('SELECT * FROM projects').all()
  ) as ProjectRow[]
  const references = db.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM tasks WHERE workspaceId = ?) AS hasTask,
       EXISTS(SELECT 1 FROM runs WHERE workspaceId = ?) AS hasRun`,
  )
  const archive = db.prepare(
    "UPDATE workspaces SET status = 'archived', archivedAt = ? WHERE id = ?",
  )
  const remove = db.prepare('DELETE FROM workspaces WHERE id = ?')
  const insertMain = db.prepare(
    `INSERT INTO workspaces (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, blockedKind, blockedReason, blockedAt, baseCommit, createdAt, archivedAt)
     VALUES (@id, @projectId, 'main checkout', @branch, @path, 'main', 'ready', '', NULL, '', '', 0, @baseCommit, @createdAt, NULL)`,
  )
  const refreshMain = db.prepare(
    `UPDATE workspaces
     SET branch = ?, path = ?, status = 'ready', setupLog = '', setupExitCode = NULL,
         blockedKind = '', blockedReason = '', blockedAt = 0, archivedAt = NULL
     WHERE id = ?`,
  )

  for (const project of projects) {
    if (!existsSync(project.path) || !git.isRepo(project.path)) continue
    const inventory = git.inspectWorktrees(project.path)
    if (!inventory.ok) continue

    const primaryPath = canonicalPath(project.path)
    const primaryBranch = git.currentBranch(project.path)
    const registered = inventory.entries.filter(
      (entry) =>
        !entry.bare &&
        canonicalPath(entry.path) !== primaryPath &&
        // Some repository layouts (notably submodules with core.worktree)
        // report the primary entry using the common Git-directory path. The
        // branch checked out at project.path is still authoritative, and Git
        // cannot have that branch checked out in a second worktree anyway.
        entry.branch !== primaryBranch,
    )
    const registeredPaths = new Set(registered.map((entry) => canonicalPath(entry.path)))
    const recorded = db
      .prepare("SELECT * FROM workspaces WHERE projectId = ? AND kind = 'worktree'")
      .all(project.id) as WorkspaceRow[]

    // Interactive chats may deliberately share the checkout open in the
    // user's editor. Keep one stable row for it, but never treat it as an
    // app-owned worktree: archive/restore and unattended policies distinguish
    // `kind='main'` below.
    const mainRows = db
      .prepare("SELECT * FROM workspaces WHERE projectId = ? AND kind = 'main'")
      .all(project.id) as WorkspaceRow[]
    const mainWorkspace = mainRows[0]
    if (mainWorkspace) {
      refreshMain.run(primaryBranch || project.defaultBranch, primaryPath, mainWorkspace.id)
    } else {
      insertMain.run({
        id: id('ws'),
        projectId: project.id,
        branch: primaryBranch || project.defaultBranch,
        path: primaryPath,
        baseCommit: git.resolveCommit(project.path, 'HEAD'),
        createdAt: project.createdAt,
      })
    }
    for (const workspace of mainRows.slice(1)) {
      const refs = references.get(workspace.id, workspace.id) as {
        hasTask: number
        hasRun: number
      }
      if (refs.hasTask || refs.hasRun) {
        if (workspace.status !== 'archived') archive.run(Date.now(), workspace.id)
      } else {
        remove.run(workspace.id)
      }
    }

    for (const workspace of recorded) {
      if (registeredPaths.has(canonicalPath(workspace.path))) continue
      const refs = references.get(workspace.id, workspace.id) as {
        hasTask: number
        hasRun: number
      }
      if (refs.hasTask || refs.hasRun) {
        if (workspace.status !== 'archived') archive.run(Date.now(), workspace.id)
      } else {
        remove.run(workspace.id)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): ProjectWithMeta[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM projects ORDER BY createdAt DESC').all() as ProjectRow[]
  const countStmt = db.prepare(
    "SELECT COUNT(*) AS n FROM workspaces WHERE projectId = ? AND status != 'archived'",
  )
  return rows.map((row) => ({
    ...row,
    workspaceCount: (countStmt.get(row.id) as { n: number }).n,
    exists: existsSync(row.path),
  }))
}

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

export type LocalDirEntry = {
  name: string
  path: string
  isGitRepo: boolean
}

export type LocalDirListing = {
  path: string
  parent: string | null
  home: string
  isGitRepo: boolean
  entries: LocalDirEntry[]
}

export type LocalPlace = {
  name: string
  path: string
}

/** Common starting points for the folder picker sidebar; missing ones are dropped. */
export function listLocalPlaces(): LocalPlace[] {
  const home = os.homedir()
  const candidates: LocalPlace[] = [
    { name: 'Home', path: home },
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') },
    { name: 'Developer', path: path.join(home, 'Developer') },
    { name: 'Dev', path: path.join(home, 'Dev') },
    { name: 'Projects', path: path.join(home, 'Projects') },
    { name: 'Code', path: path.join(home, 'code') },
    { name: 'src', path: path.join(home, 'src') },
  ]
  return candidates.filter((place) => {
    try {
      return statSync(place.path).isDirectory()
    } catch {
      return false
    }
  })
}

/** Shallow directory listing for the Add Project folder picker. */
export function listLocalDirectories(dir?: string, showHidden = false): LocalDirListing {
  const home = os.homedir()
  const raw = (dir ?? home).trim() || home
  const expanded =
    raw === '~' ? home : raw.startsWith(`~${path.sep}`) ? path.join(home, raw.slice(2)) : raw
  const resolved = path.resolve(expanded)

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`)
  }

  const parent = path.dirname(resolved)
  const entries: LocalDirEntry[] = []
  for (const name of readdirSync(resolved)) {
    if (!showHidden && name.startsWith('.')) continue
    const child = path.join(resolved, name)
    try {
      if (!statSync(child).isDirectory()) continue
    } catch {
      continue
    }
    entries.push({
      name,
      path: child,
      isGitRepo: existsSync(path.join(child, '.git')),
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    path: resolved,
    parent: parent !== resolved ? parent : null,
    home,
    isGitRepo: git.isRepo(resolved),
    entries,
  }
}

/**
 * Create a new folder under `parent` and `git init` it, so a project can start
 * from an empty directory instead of an existing checkout. Returns the absolute
 * path for the caller to register.
 */
export function createLocalFolder(input: { parent?: string; name: string }): { path: string } {
  const name = assertFolderName(input.name ?? '')
  const parent = path.resolve((input.parent ?? '').trim() || os.homedir())
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`Not a directory: ${parent}`)
  }

  const dest = path.join(parent, name)
  if (path.dirname(dest) !== parent) throw new Error(`Invalid folder name: ${name}`)
  if (existsSync(dest)) throw new Error(`Already exists: ${dest}`)

  mkdirSync(dest)
  try {
    git.initRepo(dest)
  } catch (err) {
    // Leave nothing half-made behind: the folder only existed for the repo.
    rmSync(dest, { recursive: true, force: true })
    throw err
  }
  return { path: dest }
}

export type AddProjectInput = {
  mode: 'clone' | 'register'
  url?: string
  path?: string
  name?: string
  setupCommand?: string
}

/** Derive a slug from the last path segment of a clone URL, stripping a trailing `.git`. */
function slugFromUrl(url: string): string {
  const last = url.replace(/\/+$/, '').split(/[/:]/).pop() ?? 'repo'
  return slugify(last.replace(/\.git$/, '')) || 'repo'
}

/** Pick `<base>`, or `<base>-2`, `-3`, ... — the first path that doesn't already exist. */
function uniqueDestPath(base: string): string {
  if (!existsSync(base)) return base
  let n = 2
  while (existsSync(`${base}-${n}`)) n++
  return `${base}-${n}`
}

export async function addProject(input: AddProjectInput): Promise<ProjectRow> {
  const db = getDb()
  const now = Date.now()

  if (input.mode === 'register') {
    const rawPath = (input.path ?? '').trim()
    if (!rawPath) throw new Error('A path is required to register a project')
    if (!existsSync(rawPath)) throw new Error(`Path does not exist: ${rawPath}`)
    if (!git.isRepo(rawPath)) throw new Error(`Not a git repository: ${rawPath}`)

    // Resolve to the repo root — registering a subdirectory should still
    // register (and later diff/checkout) the whole repo.
    const toplevel = git.repoInfo(rawPath).isRepo ? gitTopLevel(rawPath) : rawPath
    const resolvedPath = toplevel || rawPath

    const existing = db.prepare('SELECT id FROM projects WHERE path = ?').get(resolvedPath) as
      | { id: string }
      | undefined
    if (existing) throw new Error(`A project is already registered at ${resolvedPath}`)

    forgetDeletedProjectPath(resolvedPath)

    const name = input.name?.trim() || path.basename(resolvedPath)
    const defaultBranch = git.detectDefaultBranch(resolvedPath)
    const remoteUrlValue = git.remoteUrl(resolvedPath)

    const project: ProjectRow = {
      id: id('proj'),
      name,
      slug: slugify(name),
      path: resolvedPath,
      defaultBranch,
      remoteUrl: remoteUrlValue,
      managed: 0,
      setupCommand: input.setupCommand ?? '',
      checks: detectProjectChecks(resolvedPath),
      createdAt: now,
    }
    db.prepare(
      `INSERT INTO projects (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
       VALUES (@id, @name, @slug, @path, @defaultBranch, @remoteUrl, @managed, @setupCommand, @checks, @createdAt)`,
    ).run(project)

    reconcileWorkspaces(project.id)
    return project
  }

  // clone mode
  const url = (input.url ?? '').trim()
  if (!url) throw new Error('A URL is required to clone a project')

  const slug = slugFromUrl(url)
  const dest = uniqueDestPath(path.join(openrunHome(), 'repos', slug))
  forgetDeletedProjectPath(dest)
  await git.cloneRepo({ url, dest })

  const name = input.name?.trim() || slug
  const defaultBranch = git.detectDefaultBranch(dest)
  const remoteUrlValue = git.remoteUrl(dest) || url

  const project: ProjectRow = {
    id: id('proj'),
    name,
    // Re-slugify from the (possibly suffixed) dest dir name so a "-2" clone
    // doesn't collide with the original project's worktree paths.
    slug: path.basename(dest),
    path: dest,
    defaultBranch,
    remoteUrl: remoteUrlValue,
    managed: 1,
    setupCommand: input.setupCommand ?? '',
    checks: detectProjectChecks(dest),
    createdAt: now,
  }
  db.prepare(
    `INSERT INTO projects (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
     VALUES (@id, @name, @slug, @path, @defaultBranch, @remoteUrl, @managed, @setupCommand, @checks, @createdAt)`,
  ).run(project)

  reconcileWorkspaces(project.id)
  return project
}

function gitTopLevel(cwd: string): string {
  // repoInfo() doesn't expose the toplevel path; ask git directly the same
  // way db.ts's backfill does.
  const res = git.repoInfo(cwd)
  if (!res.isRepo) return cwd
  const out = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  return out.status === 0 ? out.stdout.trim() : cwd
}

export function updateProject(input: {
  id: string
  name?: string
  setupCommand?: string
  defaultBranch?: string
  /** Verification checks; rejected on save rather than stored and failing later. */
  checks?: unknown
}): ProjectRow {
  const db = getDb()
  const project = getProject(input.id)
  if (!project) throw new Error('Project not found')

  const updated: ProjectRow = {
    ...project,
    name: input.name?.trim() || project.name,
    setupCommand: input.setupCommand ?? project.setupCommand,
    defaultBranch: input.defaultBranch?.trim() || project.defaultBranch,
    checks:
      input.checks !== undefined ? serializeChecks(assertChecks(input.checks)) : project.checks,
  }
  db.prepare(
    'UPDATE projects SET name = @name, setupCommand = @setupCommand, defaultBranch = @defaultBranch, checks = @checks WHERE id = @id',
  ).run(updated)
  return updated
}

/** Checks a freshly added repo would get, for the "suggest" button on Projects. */
export function suggestProjectChecks(projectId: string): CheckDef[] {
  const project = getProject(projectId)
  if (!project) throw new Error('Project not found')
  return parseChecks(detectProjectChecks(project.path))
}

export function deleteProject(id: string, deleteFiles: boolean): void {
  const db = getDb()
  const project = getProject(id)
  if (!project) throw new Error('Project not found')

  const workspaces = db
    .prepare("SELECT * FROM workspaces WHERE projectId = ? AND status != 'archived'")
    .all(id) as WorkspaceRow[]

  for (const ws of workspaces) {
    const active = db
      .prepare(
        "SELECT id FROM runs WHERE workspaceId = ? AND status = 'running' AND id NOT IN (SELECT runId FROM run_environments)",
      )
      .get(ws.id) as { id: string } | undefined
    if (active) {
      throw new Error(`Cannot delete project — workspace "${ws.name}" has a run in progress`)
    }
  }

  // Legacy rows have no trustworthy ownership marker. Removing a project
  // registration must not delete their files, even when they look disposable.
  const execution = db
    .prepare(
      "SELECT r.id FROM runs r JOIN run_environments e ON e.runId = r.id WHERE e.projectId = ? AND r.status = 'running'",
    )
    .get(id)
  if (execution) throw new Error('Cannot delete a project with a run in progress')
  db.prepare('DELETE FROM projects WHERE id = ?').run(id) // cascades to workspaces
  rememberDeletedProjectPath(project.path)

  // NEVER delete a registered (managed=0) project's directory — the user owns
  // that repo and it may hold work this app knows nothing about. Only a
  // managed clone (one this app created under ~/.openrun/repos) may have its
  // files removed, and only when the caller explicitly opted in.
  if (project.managed === 1 && deleteFiles && existsSync(project.path)) {
    rmSync(project.path, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

function toWorkspaceWithMeta(db: ReturnType<typeof getDb>, ws: WorkspaceRow): WorkspaceWithMeta {
  const project = db.prepare('SELECT name FROM projects WHERE id = ?').get(ws.projectId) as
    | { name: string }
    | undefined
  const active = db
    .prepare(
      "SELECT id FROM runs WHERE workspaceId = ? AND status = 'running' AND id NOT IN (SELECT runId FROM run_environments)",
    )
    .get(ws.id) as { id: string } | undefined

  // Archived/missing worktrees have nothing to inspect on disk; avoid
  // shelling out to git for a path that no longer exists.
  const exists = existsSync(ws.path)
  const info =
    ws.status === 'archived' || !exists
      ? { dirty: false, ahead: 0, branch: '' }
      : git.hasUnpushedWork(ws.path)

  // The checkout can be switched outside openrun, so HEAD wins over the branch
  // recorded at creation. Detached HEAD reports "HEAD" — keep the record then.
  const liveBranch = info.branch && info.branch !== 'HEAD' ? info.branch : ws.branch

  return {
    ...ws,
    branch: liveBranch,
    configuredBranch: ws.branch,
    actualBranch: info.branch,
    exists,
    projectName: project?.name ?? '(deleted project)',
    dirty: info.dirty,
    ahead: info.ahead,
    activeRunId: active?.id ?? null,
  }
}

export function listWorkspaces(projectId?: string): WorkspaceWithMeta[] {
  reconcileWorkspaces(projectId)
  const db = getDb()
  const rows = (
    projectId
      ? db
          .prepare('SELECT * FROM workspaces WHERE projectId = ? ORDER BY createdAt DESC')
          .all(projectId)
      : db.prepare('SELECT * FROM workspaces ORDER BY createdAt DESC').all()
  ) as WorkspaceRow[]
  return rows.map((ws) => toWorkspaceWithMeta(db, ws))
}

export function listProjectBranches(projectId: string): GitBranchRow[] {
  const project = getProject(projectId)
  if (!project || !existsSync(project.path) || !git.isRepo(project.path)) return []
  return git.listRecentBranches(project.path)
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | WorkspaceRow
    | undefined
}

/** Find another enabled schedule/webhook task that owns this managed worktree. */
export function getUnattendedWorkspaceOwner(
  workspaceId: string,
  taskId: string,
): { id: string; name: string } | undefined {
  // Compatibility API: each invocation now owns its execution directory.
  void workspaceId
  void taskId
  return undefined
}

export async function createWorkspace(input: {
  projectId: string
  branch: string
  fromBranch?: string
  useExistingBranch?: boolean
}): Promise<WorkspaceRow> {
  const db = getDb()
  const project = getProject(input.projectId)
  if (!project) throw new Error('Project not found')

  const branch = input.branch.trim()
  if (!branch) throw new Error('A branch name is required')

  const wsPath = uniqueDestPath(
    path.join(openrunHome(), 'worktrees', project.slug, slugify(branch)),
  )

  const fromBranch = input.fromBranch?.trim() || project.defaultBranch
  // Prefer the remote-tracking ref when it resolves — a freshly cloned repo
  // has origin refs and the local branch may not exist or be stale. A
  // registered repo may be offline / have no origin, so fall back to the
  // plain local branch name in that case.
  const remoteRef = `origin/${fromBranch}`
  const baseRef =
    git.isRepo(project.path) && refExists(project.path, remoteRef) ? remoteRef : fromBranch
  const baseCommit = git.resolveCommit(project.path, baseRef)
  if (!baseCommit) throw new Error(`Could not resolve the workspace base ref "${baseRef}"`)

  // Insert as 'creating' BEFORE touching git so the UI has a row to show
  // progress against immediately, instead of the workspace appearing out of
  // nowhere once (possibly slow) git/setup work finishes.
  const now = Date.now()
  const workspace: WorkspaceRow = {
    id: id('ws'),
    projectId: project.id,
    name: branch,
    branch,
    path: wsPath,
    kind: 'worktree',
    status: 'creating',
    setupLog: '',
    setupExitCode: null,
    blockedKind: '',
    blockedReason: '',
    blockedAt: 0,
    baseCommit,
    createdAt: now,
    archivedAt: null,
  }
  db.prepare(
    `INSERT INTO workspaces (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, blockedKind, blockedReason, blockedAt, baseCommit, createdAt, archivedAt)
     VALUES (@id, @projectId, @name, @branch, @path, @kind, @status, @setupLog, @setupExitCode, @blockedKind, @blockedReason, @blockedAt, @baseCommit, @createdAt, @archivedAt)`,
  ).run(workspace)

  try {
    git.addWorktree({
      repoPath: project.path,
      branch,
      path: wsPath,
      baseRef,
      newBranch: !input.useExistingBranch,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE workspaces SET status = 'error', setupLog = ? WHERE id = ?").run(
      message,
      workspace.id,
    )
    throw err
  }

  return runSetup(workspace.id)
}

function refExists(repoPath: string, ref: string): boolean {
  const res = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd: repoPath,
    encoding: 'utf8',
  })
  return res.status === 0
}

export async function runSetup(workspaceId: string): Promise<WorkspaceRow> {
  const db = getDb()
  const workspace = getWorkspace(workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  const project = getProject(workspace.projectId)
  if (!project) throw new Error('Project not found')

  // A freshly created worktree has no node_modules/.env/build output — every
  // agent run against it would otherwise fail confusingly on "command not
  // found" rather than a clear setup error. Running setup here (and exposing
  // a retry) turns that into a visible, fixable step instead of silent flakiness.
  if (!project.setupCommand.trim()) {
    db.prepare("UPDATE workspaces SET status = 'ready' WHERE id = ?").run(workspaceId)
    return getWorkspace(workspaceId)!
  }

  // Async and budgeted. This is usually `pnpm install`: minutes of work that,
  // run synchronously, froze every other request and stopped the SSE
  // heartbeats — and a setup command that waited on stdin froze Open Run for
  // good.
  const res = await runCommand({
    command: project.setupCommand,
    cwd: workspace.path,
    shell: true,
    env: process.env,
    timeoutMs: SETUP_TIMEOUT_MS,
  })
  const setupLog = res.timedOut
    ? `${res.stdout}${res.stderr}\n${commandTimedOutMessage('The setup command', SETUP_TIMEOUT_MS)}\n`
    : res.outputTooLarge
      ? `${res.stdout}${res.stderr}\n${commandOutputTooLargeMessage('The setup command')}\n`
      : `${res.stdout}${res.stderr}`
  const exitCode = res.timedOut || res.outputTooLarge ? -1 : (res.status ?? -1)
  const status = exitCode === 0 ? 'ready' : 'error'

  db.prepare('UPDATE workspaces SET status = ?, setupLog = ?, setupExitCode = ? WHERE id = ?').run(
    status,
    setupLog,
    exitCode,
    workspaceId,
  )

  return getWorkspace(workspaceId)!
}

export function archiveWorkspace(
  id: string,
  force: boolean,
): { removed: boolean; warning?: string } {
  const db = getDb()
  const workspace = getWorkspace(id)
  if (!workspace) throw new Error('Workspace not found')

  const active = db
    .prepare(
      "SELECT id FROM runs WHERE workspaceId = ? AND status = 'running' AND id NOT IN (SELECT runId FROM run_environments)",
    )
    .get(id) as { id: string } | undefined
  if (active) throw new Error('Cannot archive a workspace with a run in progress')

  // The 'main' workspace is the user's own checkout, shared with their
  // editor — archiving (and removing the worktree of) it would delete work
  // the app never created and doesn't own.
  if (workspace.kind === 'main') {
    throw new Error('Cannot archive the main checkout — this is your own working copy')
  }

  const project = getProject(workspace.projectId)
  if (!project) throw new Error('Project not found')

  if (existsSync(workspace.path)) {
    const { dirty, ahead } = git.hasUnpushedWork(workspace.path)
    if ((dirty || ahead > 0) && !force) {
      const parts: string[] = []
      if (dirty) parts.push('uncommitted changes')
      if (ahead > 0) parts.push(`${ahead} unpushed commit${ahead === 1 ? '' : 's'}`)
      throw new Error(`Workspace has ${parts.join(' and ')} — archive with force to discard`)
    }
    git.removeWorktree(project.path, workspace.path, force)
  }

  const archivedAt = Date.now()
  db.prepare("UPDATE workspaces SET status = 'archived', archivedAt = ? WHERE id = ?").run(
    archivedAt,
    id,
  )

  return { removed: true }
}

export function resolveWorkspacePath(workspaceId: string): string {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  const project = getProject(workspace.projectId)
  if (workspace.kind !== 'worktree' && workspace.kind !== 'main') {
    throw new Error('Unsupported workspace kind')
  }
  // Chat already refused non-ready workspaces; automations used to only check
  // that an id was present and then spawn into a half-baked creating/error tree.
  assertWorkspaceReady(workspace.status)
  // …and `ready` is only a record of what we last did to the directory. When
  // the worktree has since been removed, spawning into it fails with a bare
  // `spawn <cli> ENOENT` that reads as a missing CLI. Demote the row so it
  // stops being offered, and say what actually happened.
  if (!existsSync(workspace.path)) {
    const message = missingWorkspaceDirMessage(workspace.path)
    getDb()
      .prepare("UPDATE workspaces SET status = 'error', setupLog = ? WHERE id = ?")
      .run(message, workspace.id)
    throw new Error(message)
  }
  if (workspace.kind === 'worktree' && project && git.isRepo(project.path)) {
    const inventory = git.inspectWorktrees(project.path)
    const registered = inventory.entries.some(
      (entry) => !entry.bare && canonicalPath(entry.path) === canonicalPath(workspace.path),
    )
    if (inventory.ok && !registered) {
      const message = missingWorkspaceDirMessage(workspace.path)
      getDb()
        .prepare("UPDATE workspaces SET status = 'archived', archivedAt = ? WHERE id = ?")
        .run(Date.now(), workspace.id)
      throw new Error(message)
    }
  }
  return workspace.path
}

/**
 * Two agent processes writing into the same worktree at once interleave file
 * edits and git operations, producing corrupted diffs and confusing commits
 * that belong to neither run. Every run must have the workspace to itself.
 */
export function assertWorkspaceFree(workspaceId: string): void {
  if (isWorkspaceCancellationPending(workspaceId)) {
    throw new Error(workspaceBusyMessage())
  }
  const active = getDb()
    .prepare(
      "SELECT id FROM runs WHERE (workspaceId = ? OR cwd = ?) AND status = 'running' AND id NOT IN (SELECT runId FROM run_environments)",
    )
    .get(workspaceId, getWorkspace(workspaceId)?.path ?? '') as { id: string } | undefined
  if (active) {
    throw new Error(workspaceBusyMessage())
  }
}
