/**
 * Projects & workspaces.
 *
 * A "project" is a git repo on disk — either cloned by this app (`managed=1`,
 * safe to delete) or an existing local repo the user pointed us at
 * (`managed=0`, we never touch its directory). A "workspace" is a git worktree
 * + branch checked out off a project so an agent run gets its own isolated
 * working tree instead of fighting other runs (or the user's editor) over the
 * same files.
 *
 * Worktrees always live under `~/.openrun/worktrees/<projectSlug>/<branch>`,
 * never inside the project's own repo directory. That keeps them out of the
 * agent's own file listings when it `ls`s the repo root, keeps `git status` in
 * the user's primary checkout clean, and means archiving a workspace can never
 * accidentally remove something the user placed inside their repo.
 *
 * A registered project's primary checkout is also modeled as a workspace, with
 * `kind='main'` — that's the one shared with the user's own editor, so its
 * diffs include their in-progress edits. A managed (app-cloned) project has no
 * such checkout to share, so it never gets a `kind='main'` row; every unit of
 * work against it gets its own worktree from the start.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
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

export type ProjectWithMeta = ProjectRow & {
  /** Count of this project's workspaces excluding archived ones. */
  workspaceCount: number
  /** Whether the project's directory is still present on disk. */
  exists: boolean
}

export type WorkspaceWithMeta = WorkspaceRow & {
  projectName: string
  dirty: boolean
  ahead: number
  /** id of a run with status='running' in this workspace, or null when free. */
  activeRunId: string | null
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

/** Shallow directory listing for the Add Project folder picker. */
export function listLocalDirectories(dir?: string): LocalDirListing {
  const home = os.homedir()
  const raw = (dir ?? home).trim() || home
  const resolved = path.resolve(raw)

  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`)
  }

  const parent = path.dirname(resolved)
  const entries: LocalDirEntry[] = []
  for (const name of readdirSync(resolved)) {
    if (name.startsWith('.')) continue
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

export function addProject(input: AddProjectInput): ProjectRow {
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

    // The user's own checkout — shared with their editor, so its diffs
    // include whatever they're already working on outside of this app.
    const workspace: WorkspaceRow = {
      id: id('ws'),
      projectId: project.id,
      name: 'main checkout',
      branch: defaultBranch,
      path: resolvedPath,
      kind: 'main',
      status: 'ready',
      setupLog: '',
      setupExitCode: null,
      createdAt: now,
      archivedAt: null,
    }
    db.prepare(
      `INSERT INTO workspaces (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
       VALUES (@id, @projectId, @name, @branch, @path, @kind, @status, @setupLog, @setupExitCode, @createdAt, @archivedAt)`,
    ).run(workspace)

    return project
  }

  // clone mode
  const url = (input.url ?? '').trim()
  if (!url) throw new Error('A URL is required to clone a project')

  const slug = slugFromUrl(url)
  const dest = uniqueDestPath(path.join(openrunHome(), 'repos', slug))
  forgetDeletedProjectPath(dest)
  git.cloneRepo({ url, dest })

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

  // No kind='main' workspace here — a managed clone has no user checkout to
  // share; every unit of work against it gets its own worktree.
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
      .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running'")
      .get(ws.id) as { id: string } | undefined
    if (active) {
      throw new Error(`Cannot delete project — workspace "${ws.name}" has a run in progress`)
    }
  }

  // Best-effort removal of worktrees before the row disappears. Force, since
  // the project itself is being torn down — there is no "retry later".
  for (const ws of workspaces) {
    if (ws.kind === 'worktree') {
      try {
        git.removeWorktree(project.path, ws.path, true)
      } catch {
        // The worktree directory may already be gone; the project row delete
        // below is what actually matters for app state.
      }
    }
  }

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
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running'")
    .get(ws.id) as { id: string } | undefined

  // Archived/missing worktrees have nothing to inspect on disk; avoid
  // shelling out to git for a path that no longer exists.
  const info =
    ws.status === 'archived' || !existsSync(ws.path)
      ? { dirty: false, ahead: 0 }
      : git.hasUnpushedWork(ws.path)

  return {
    ...ws,
    projectName: project?.name ?? '(deleted project)',
    dirty: info.dirty,
    ahead: info.ahead,
    activeRunId: active?.id ?? null,
  }
}

export function listWorkspaces(projectId?: string): WorkspaceWithMeta[] {
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

export function createWorkspace(input: {
  projectId: string
  branch: string
  fromBranch?: string
  useExistingBranch?: boolean
}): WorkspaceRow {
  const db = getDb()
  const project = getProject(input.projectId)
  if (!project) throw new Error('Project not found')

  const branch = input.branch.trim()
  if (!branch) throw new Error('A branch name is required')

  const wsPath = uniqueDestPath(
    path.join(openrunHome(), 'worktrees', project.slug, slugify(branch)),
  )

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
    createdAt: now,
    archivedAt: null,
  }
  db.prepare(
    `INSERT INTO workspaces (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES (@id, @projectId, @name, @branch, @path, @kind, @status, @setupLog, @setupExitCode, @createdAt, @archivedAt)`,
  ).run(workspace)

  const fromBranch = input.fromBranch?.trim() || project.defaultBranch
  // Prefer the remote-tracking ref when it resolves — a freshly cloned repo
  // has origin refs and the local branch may not exist or be stale. A
  // registered repo may be offline / have no origin, so fall back to the
  // plain local branch name in that case.
  const remoteRef = `origin/${fromBranch}`
  const baseRef =
    git.isRepo(project.path) && refExists(project.path, remoteRef) ? remoteRef : fromBranch

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

export function runSetup(workspaceId: string): WorkspaceRow {
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

  const res = spawnSync(project.setupCommand, {
    cwd: workspace.path,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  })
  const setupLog = `${res.stdout ?? ''}${res.stderr ?? ''}`
  const exitCode = res.status ?? -1
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
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running'")
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
  // Chat already refused non-ready workspaces; automations used to only check
  // that an id was present and then spawn into a half-baked creating/error tree.
  assertWorkspaceReady(workspace.status)
  return workspace.path
}

/**
 * Two agent processes writing into the same worktree at once interleave file
 * edits and git operations, producing corrupted diffs and confusing commits
 * that belong to neither run. Every run must have the workspace to itself.
 */
export function assertWorkspaceFree(workspaceId: string): void {
  const active = getDb()
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running'")
    .get(workspaceId) as { id: string } | undefined
  if (active) {
    throw new Error('This workspace already has a run in progress')
  }
}
