import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createServer } from 'vite'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-queue-'))
const oldRepo = join(root, 'old')
const newRepo = join(root, 'new')
for (const repo of [oldRepo, newRepo]) {
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 'queue@example.test'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Queue Test'], { cwd: repo })
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: repo })
}

const cwdBefore = process.cwd()
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
const { enqueueRun, drainWorkspace, listQueue } = (await vite.ssrLoadModule(
  '/src/server/runQueue.ts',
)) as typeof import('./runQueue.ts')
const { cancelRun, reconcileOrphanRuns } = (await vite.ssrLoadModule(
  '/src/server/executor.ts',
)) as typeof import('./executor.ts')

after(async () => {
  closeDb()
  await vite.close()
  process.chdir(cwdBefore)
  rmSync(root, { recursive: true, force: true })
})

function seed() {
  const db = getDb()
  db.exec(
    'DELETE FROM messages; DELETE FROM runs; DELETE FROM run_queue; DELETE FROM tasks; DELETE FROM workspaces; DELETE FROM projects; DELETE FROM runtimes;',
  )
  db.prepare(
    `INSERT INTO runtimes
       (id, label, bin, argsTemplate, promptViaStdin, description, enabled, canOpenPrs, transport, createdAt)
     VALUES ('queue-runtime', 'Queue runtime', ?, ?, 0, '', 1, 0, 'cli', 1)`,
  ).run(process.execPath, JSON.stringify(['-e', 'process.exit(0)']))
  for (const [id, path] of [
    ['project-old', oldRepo],
    ['project-new', newRepo],
  ] as const) {
    db.prepare(
      `INSERT INTO projects
         (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
       VALUES (?, ?, ?, ?, 'main', '', 0, '', '[]', 1)`,
    ).run(id, id, id, path)
  }
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES ('workspace-old', 'project-old', 'Old', 'main', ?, 'main', 'ready', '', NULL, 1, NULL)`,
  ).run(oldRepo)
  for (const id of ['workspace-cancel', 'workspace-orphan']) {
    db.prepare(
      `INSERT INTO workspaces
         (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
       VALUES (?, 'project-old', 'Managed', 'openrun/feature', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
    ).run(id, oldRepo)
  }
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES ('workspace-new', 'project-new', 'New', 'main', ?, 'main', 'ready', '', NULL, 1, NULL)`,
  ).run(newRepo)
  db.prepare(
    `INSERT INTO tasks
       (id, name, description, runtimeId, prompt, cwd, workspaceId, cron, enabled,
        model, effort, webhookIntegrationId, webhookEvents, webhookFilters,
        verifyEnabled, maxRepairAttempts, timeoutMs, resumeSessionId,
        resumeSessionLabel, fireOnce, scheduledAt, requireIsolation, requireGhAuth,
        createdAt, updatedAt, lastRunAt)
     VALUES ('queue-task', 'Moved task', '', 'queue-runtime', 'work', ?, 'workspace-old', '* * * * *', 1,
             '', '', '', '[]', '{}', 0, 0, 0, '', '', 0, 0, 0, 0, 1, 1, NULL)`,
  ).run(oldRepo)
  db.prepare(
    `INSERT INTO runs
       (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid,
        exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot)
     VALUES ('busy-run', NULL, 'Busy', 'queue-runtime', 'manual', 'running', '', ?, 'workspace-old', NULL,
             NULL, '', '', 1, NULL, '', 'main', '')`,
  ).run(oldRepo)
  db.prepare(
    `INSERT INTO runs
       (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid,
        exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot)
     VALUES ('cancel-run', NULL, 'Cancelled unattended', 'queue-runtime', 'webhook', 'running', '', ?, 'workspace-cancel', NULL,
             NULL, '', '', 1, NULL, '', 'openrun/feature', '')`,
  ).run(oldRepo)
  db.prepare(
    `INSERT INTO runs
       (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid,
        exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot)
     VALUES ('orphan-run', NULL, 'Orphan unattended', 'queue-runtime', 'schedule', 'running', '', ?, 'workspace-orphan', NULL,
             NULL, '', '', 1, NULL, '', 'openrun/feature', '')`,
  ).run(oldRepo)
}

describe('server pending-run queue', () => {
  it('refuses to queue a fire when the workspace is not busy', () => {
    seed()
    getDb().prepare("UPDATE runs SET status = 'error' WHERE id = 'busy-run'").run()
    const result = enqueueRun({
      taskId: 'queue-task',
      workspaceId: 'workspace-old',
      trigger: 'webhook',
    })
    assert.deepEqual(result, { queued: false, reason: 'This workspace is not busy' })
  })

  it('moves a stale entry to the task workspace before starting it', async () => {
    seed()
    const queued = enqueueRun({
      taskId: 'queue-task',
      workspaceId: 'workspace-old',
      trigger: 'schedule',
    })
    assert.equal(queued.queued, true)
    getDb().prepare("UPDATE runs SET status = 'error' WHERE id = 'busy-run'").run()
    getDb()
      .prepare("UPDATE tasks SET workspaceId = ?, cwd = ? WHERE id = 'queue-task'")
      .run('workspace-new', newRepo)

    drainWorkspace('workspace-old')
    assert.equal(listQueue('workspace-old').length, 0)
    const run = getDb()
      .prepare(
        "SELECT cwd, workspaceId, trigger FROM runs WHERE taskId = 'queue-task' ORDER BY startedAt DESC LIMIT 1",
      )
      .get() as { cwd: string; workspaceId: string; trigger: string } | undefined
    assert.deepEqual(run, { cwd: newRepo, workspaceId: 'workspace-new', trigger: 'schedule' })

    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const status = getDb().prepare("SELECT status FROM runs WHERE taskId = 'queue-task'").get() as
        | { status: string }
        | undefined
      if (status?.status !== 'running') return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('moved queued run did not finish')
  })

  it('quarantines an unattended run when cancellation has no child handle', async () => {
    seed()
    assert.equal(cancelRun('cancel-run'), false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get('cancel-run') as {
      status: string
    }
    const workspace = getDb()
      .prepare('SELECT blockedKind FROM workspaces WHERE id = ?')
      .get('workspace-cancel') as { blockedKind: string }
    assert.equal(row.status, 'cancelled')
    assert.equal(workspace.blockedKind, 'run')
  })

  it('keeps a cancelled child workspace busy until the process exits', async () => {
    seed()
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'])
    assert.ok(child.pid)
    getDb().prepare('UPDATE runs SET pid = ? WHERE id = ?').run(child.pid, 'cancel-run')
    assert.equal(cancelRun('cancel-run'), true)
    assert.equal(
      (
        getDb().prepare('SELECT status FROM runs WHERE id = ?').get('cancel-run') as {
          status: string
        }
      ).status,
      'running',
    )
    const { workspaceBusy } = (await vite.ssrLoadModule(
      '/src/server/runQueue.ts',
    )) as typeof import('./runQueue.ts')
    assert.equal(workspaceBusy('workspace-cancel'), true)

    const deadline = Date.now() + 2500
    while (Date.now() < deadline) {
      const status = (
        getDb().prepare('SELECT status FROM runs WHERE id = ?').get('cancel-run') as {
          status: string
        }
      ).status
      if (status === 'cancelled') return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    child.kill('SIGKILL')
    throw new Error('cancelled child did not finish cleanup')
  })

  it('quarantines scheduled orphan rows during restart reconciliation', () => {
    seed()
    reconcileOrphanRuns()
    const row = getDb()
      .prepare('SELECT status, verdict FROM runs WHERE id = ?')
      .get('orphan-run') as { status: string; verdict: string }
    const workspace = getDb()
      .prepare('SELECT blockedKind FROM workspaces WHERE id = ?')
      .get('workspace-orphan') as { blockedKind: string }
    assert.equal(row.status, 'error')
    assert.equal(row.verdict, 'crashed')
    assert.equal(workspace.blockedKind, 'run')
  })
})
