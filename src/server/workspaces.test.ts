import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createServer } from 'vite'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-workspaces-'))
const repo = join(root, 'repo')
const manualWorktree = join(root, 'manual-worktree')
mkdirSync(repo)
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 'workspaces@example.test'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'Workspace Test'], { cwd: repo })
execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: repo })

const cwdBefore = process.cwd()
const previousOpenrunHome = process.env.OPENRUN_HOME
process.chdir(root)
process.env.OPENRUN_HOME = join(root, 'openrun-home')
const vite = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
})
const { closeDb, getDb } = (await vite.ssrLoadModule(
  '/src/server/db.ts',
)) as typeof import('./db.ts')
const workspaces = (await vite.ssrLoadModule(
  '/src/server/workspaces.ts',
)) as typeof import('./workspaces.ts')

after(async () => {
  closeDb()
  await vite.close()
  if (previousOpenrunHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousOpenrunHome
  process.chdir(cwdBefore)
  rmSync(root, { recursive: true, force: true })
})

describe('Git worktree reconciliation', () => {
  it('imports manually added worktrees and deletes removed unreferenced rows', () => {
    const project = workspaces.addProject({ mode: 'register', path: repo })
    assert.deepEqual(workspaces.listWorkspaces(project.id), [])
    assert.throws(
      () =>
        workspaces.createWorkspace({
          projectId: project.id,
          branch: 'main',
          useExistingBranch: true,
        }),
      /already used by worktree|already checked out/i,
    )

    execFileSync('git', ['worktree', 'add', '-q', '-b', 'feature/manual', manualWorktree, 'main'], {
      cwd: repo,
    })
    const imported = workspaces.listWorkspaces(project.id)
    assert.equal(imported.length, 1)
    assert.equal(imported[0]?.branch, 'feature/manual')
    assert.equal(imported[0]?.path, realpathSync(manualWorktree))

    execFileSync('git', ['worktree', 'remove', manualWorktree], { cwd: repo })
    assert.deepEqual(workspaces.listWorkspaces(project.id), [])
    const count = getDb()
      .prepare('SELECT COUNT(*) AS count FROM workspaces WHERE projectId = ?')
      .get(project.id) as { count: number }
    assert.equal(count.count, 0)
  })
})
