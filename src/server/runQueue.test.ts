import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createServer } from 'vite'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-queue-'))
const oldProject = join(root, 'project-old')
const newProject = join(root, 'project-new')
const oldRepo = join(root, 'old')
const newRepo = join(root, 'new')
for (const [project, workspace, branch] of [
  [oldProject, oldRepo, 'openrun/old'],
  [newProject, newRepo, 'openrun/new'],
] as const) {
  mkdirSync(project)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'queue@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'Queue Test'], { cwd: project })
  execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: project })
  execFileSync('git', ['worktree', 'add', '-q', '-b', branch, workspace, 'main'], {
    cwd: project,
  })
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
const { enqueueRun, drainWorkspace, listQueue, workspaceBusy } = (await vite.ssrLoadModule(
  '/src/server/runQueue.ts',
)) as typeof import('./runQueue.ts')
const { acquireVerificationController, cancelRun, reconcileOrphanRuns, runTask } =
  (await vite.ssrLoadModule('/src/server/executor.ts')) as typeof import('./executor.ts')

after(async () => {
  closeDb()
  await vite.close()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
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
  for (const [id, projectPath] of [
    ['project-old', oldProject],
    ['project-new', newProject],
  ] as const) {
    db.prepare(
      `INSERT INTO projects
         (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
       VALUES (?, ?, ?, ?, 'main', '', 0, '', ?, 1)`,
    ).run(
      id,
      id,
      id,
      projectPath,
      JSON.stringify([
        {
          id: 'queue-check',
          name: 'queue check',
          command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
        },
      ]),
    )
  }
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES ('workspace-old', 'project-old', 'Old', 'openrun/old', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
  ).run(oldRepo)
  for (const id of ['workspace-cancel', 'workspace-orphan']) {
    db.prepare(
      `INSERT INTO workspaces
         (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
       VALUES (?, 'project-old', 'Managed', 'openrun/old', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
    ).run(id, oldRepo)
  }
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES ('workspace-new', 'project-new', 'New', 'openrun/new', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
  ).run(newRepo)
  db.prepare(
    `INSERT INTO tasks
       (id, name, description, runtimeId, prompt, cwd, workspaceId, cron, enabled,
        model, effort, webhookIntegrationId, webhookEvents, webhookFilters,
        verifyEnabled, maxRepairAttempts, timeoutMs, resumeSessionId,
        resumeSessionLabel, fireOnce, scheduledAt, requireIsolation, requireGhAuth,
        createdAt, updatedAt, lastRunAt)
     VALUES ('queue-task', 'Moved task', '', 'queue-runtime', 'work', ?, 'workspace-old', '* * * * *', 1,
             '', '', '', '[]', '{}', 1, 0, 0, '', '', 0, 0, 0, 0, 1, 1, NULL)`,
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
    assert.equal(run?.workspaceId, 'workspace-new')
    assert.equal(run?.trigger, 'schedule')
    assert.notEqual(run?.cwd, newRepo)
    assert.match(run!.cwd, /executions\/run_/)

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

  it('fails a moved fire when the destination fails its final preflight', () => {
    seed()
    assert.equal(
      enqueueRun({
        taskId: 'queue-task',
        workspaceId: 'workspace-old',
        trigger: 'schedule',
      }).queued,
      true,
    )
    getDb().prepare("UPDATE runs SET status = 'error' WHERE id = 'busy-run'").run()
    getDb()
      .prepare("UPDATE tasks SET workspaceId = ?, cwd = ? WHERE id = 'queue-task'")
      .run('workspace-new', newRepo)
    // Workspace A was healthy when the fire queued. The drain must inspect B,
    // including its verification policy, before it can call runTask.
    getDb().prepare("UPDATE projects SET checks = '[]' WHERE id = 'project-new'").run()

    drainWorkspace('workspace-old')
    assert.equal(
      (
        getDb().prepare("SELECT COUNT(*) AS n FROM runs WHERE taskId = 'queue-task'").get() as {
          n: number
        }
      ).n,
      0,
    )
    assert.equal(listQueue('workspace-new').length, 0)
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

  it('does not start verification after cancellation wins during acquisition', async () => {
    seed()
    const db = getDb()
    db.prepare("UPDATE runs SET status = 'error' WHERE id = 'busy-run'").run()
    db.prepare(
      "UPDATE tasks SET workspaceId = 'workspace-cancel', cwd = ? WHERE id = 'queue-task'",
    ).run(oldRepo)
    assert.equal(
      enqueueRun({
        taskId: 'queue-task',
        workspaceId: 'workspace-cancel',
        trigger: 'webhook',
      }).queued,
      true,
    )

    // The callback is the exact post-registration/pre-flight seam. It runs
    // synchronously, so this exercises the race without relying on a timer.
    const controller = acquireVerificationController('cancel-run', () => {
      assert.equal(cancelRun('cancel-run'), true)
      assert.equal(
        (db.prepare("SELECT status FROM runs WHERE id = 'cancel-run'").get() as { status: string })
          .status,
        'running',
      )
      assert.equal(listQueue('workspace-cancel').length, 1)
    })
    assert.equal(controller, null)
    assert.equal(
      (
        db.prepare("SELECT COUNT(*) AS n FROM check_results WHERE runId = 'cancel-run'").get() as {
          n: number
        }
      ).n,
      0,
    )

    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const status = (
        db.prepare("SELECT status FROM runs WHERE id = 'cancel-run'").get() as {
          status: string
        }
      ).status
      if (status === 'cancelled') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(
      (db.prepare("SELECT status FROM runs WHERE id = 'cancel-run'").get() as { status: string })
        .status,
      'cancelled',
    )
    assert.equal(workspaceBusy('workspace-cancel'), false)
    assert.equal(listQueue('workspace-cancel').length, 1)
  })

  it('keeps an execution active until aborted verification closes without locking the project', async () => {
    seed()
    getDb().prepare("UPDATE runs SET status = 'error' WHERE id = 'cancel-run'").run()
    const started = join(root, 'verification-started')
    const checkScript = join(root, 'slow-verification.js')
    writeFileSync(
      checkScript,
      `require('fs').writeFileSync(${JSON.stringify(started)}, 'started')
process.on('SIGTERM', () => setTimeout(() => process.exit(0), 800))
setTimeout(() => {}, 30_000)
`,
    )
    const db = getDb()
    db.prepare('UPDATE projects SET checks = ? WHERE id = ?').run(
      JSON.stringify([
        {
          id: 'slow-check',
          name: 'slow check',
          command: `${JSON.stringify(process.execPath)} ${JSON.stringify(checkScript)}`,
        },
      ]),
      'project-old',
    )
    db.prepare(
      "UPDATE tasks SET workspaceId = 'workspace-cancel', cwd = ?, verifyEnabled = 1 WHERE id = 'queue-task'",
    ).run(oldRepo)
    const task = db.prepare("SELECT * FROM tasks WHERE id = 'queue-task'").get() as Parameters<
      typeof runTask
    >[0]
    const runtime = db
      .prepare("SELECT * FROM runtimes WHERE id = 'queue-runtime'")
      .get() as Parameters<typeof runTask>[1]
    const runId = runTask(task, runtime, 'webhook')
    const queued = enqueueRun({
      taskId: task.id,
      workspaceId: task.workspaceId,
      trigger: 'webhook',
    })
    assert.equal(queued.queued, false)

    const startDeadline = Date.now() + 3000
    while (!existsSync(started) && Date.now() < startDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(existsSync(started), true)
    assert.equal(cancelRun(runId), true)

    // The abort signal is delivered immediately, but the check deliberately
    // stays alive for 800ms. Neither the terminal row nor queue drain may run
    // during that interval.
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(
      (db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: string }).status,
      'running',
    )
    assert.equal(listQueue(task.workspaceId).length, 0)

    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      const status = (
        db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: string }
      ).status
      if (status === 'cancelled') break
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    assert.equal(
      (db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: string }).status,
      'cancelled',
    )
    // This executor-only fixture does not install core's finalized hook. A
    // drain is safe now, and the terminal preflight removes the quarantined
    // queued fire; importantly it was not possible during verification.
    drainWorkspace(task.workspaceId)
    assert.equal(listQueue(task.workspaceId).length, 0)
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
