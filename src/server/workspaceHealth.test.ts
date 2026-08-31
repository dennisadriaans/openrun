import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createServer } from 'vite'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-workspace-health-'))
const projectRepo = join(root, 'project')
const staleRepo = join(root, 'stale')
mkdirSync(projectRepo)
mkdirSync(staleRepo)
for (const cwd of [projectRepo, staleRepo]) {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd })
  execFileSync('git', ['config', 'user.email', 'health@example.test'], { cwd })
  execFileSync('git', ['config', 'user.name', 'Health Test'], { cwd })
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd })
}

const cwdBefore = process.cwd()
const previousHome = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = join(root, '.openrun')
process.chdir(root)
const vite = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
})
const { closeDb, getDb } = (await vite.ssrLoadModule(
  '/src/server/db.ts',
)) as typeof import('./db.ts')
const { isRegisteredWorktree, recordRunOutcomeForWorkspace, restoreWorkspace } =
  (await vite.ssrLoadModule(
    '/src/server/workspaceHealth.ts',
  )) as typeof import('./workspaceHealth.ts')

after(async () => {
  closeDb()
  await vite.close()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
})

function seedWorkspace(id: string, path: string) {
  const db = getDb()
  db.prepare(
    `INSERT INTO projects
       (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
     VALUES (?, 'Project', ?, ?, 'main', '', 0, '', '[]', 1)`,
  ).run(`project-${id}`, id, projectRepo)
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES (?, ?, 'Feature', 'openrun/feature', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
  ).run(id, `project-${id}`, path)
}

describe('workspace restore safety', () => {
  it('rejects an unrelated repository at a stale recorded path', () => {
    seedWorkspace('stale-worktree', staleRepo)
    const workspace = getDb()
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get('stale-worktree') as Parameters<typeof isRegisteredWorktree>[0]
    assert.equal(isRegisteredWorktree(workspace), false)
    assert.throws(() => restoreWorkspace('stale-worktree'), /no longer a registered worktree/i)
  })

  it('quarantines an unverified unattended outcome', () => {
    seedWorkspace('unverified-worktree', join(root, 'not-used'))
    recordRunOutcomeForWorkspace({
      workspaceId: 'unverified-worktree',
      taskName: 'Nightly docs',
      verdict: 'unverified',
    })
    const row = getDb()
      .prepare('SELECT blockedKind, blockedReason FROM workspaces WHERE id = ?')
      .get('unverified-worktree') as { blockedKind: string; blockedReason: string }
    assert.equal(row.blockedKind, 'run')
    assert.match(row.blockedReason, /Nightly docs/)
  })

  it('resets local commits to the immutable workspace base', () => {
    const managedPath = join(root, 'managed')
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'openrun/feature', managedPath, 'main'], {
      cwd: projectRepo,
    })
    const baseCommit = execFileSync('git', ['rev-parse', 'main'], {
      cwd: projectRepo,
      encoding: 'utf8',
    }).trim()
    writeFileSync(join(managedPath, 'agent.txt'), 'local commit\n')
    execFileSync('git', ['add', 'agent.txt'], { cwd: managedPath })
    execFileSync('git', ['commit', '-qm', 'agent local commit'], { cwd: managedPath })

    const db = getDb()
    db.prepare(
      `INSERT INTO projects
         (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
       VALUES ('restore-project', 'Restore project', 'restore-project', ?, 'main', '', 0, '', '[]', 1)`,
    ).run(projectRepo)
    db.prepare(
      `INSERT INTO workspaces
         (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, baseCommit, createdAt, archivedAt)
       VALUES ('restore-worktree', 'restore-project', 'Feature', 'openrun/feature', ?, 'worktree', 'ready', '', NULL, ?, 1, NULL)`,
    ).run(managedPath, baseCommit)

    const result = restoreWorkspace('restore-worktree')
    assert.equal(result.discarded, true)
    assert.equal(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: managedPath, encoding: 'utf8' }).trim(),
      baseCommit,
    )
    assert.equal(
      execFileSync('git', ['branch', '--show-current'], {
        cwd: managedPath,
        encoding: 'utf8',
      }).trim(),
      'openrun/feature',
    )
  })
})
