import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createServer } from 'vite'
import type { ScheduleFireRow } from './db.ts'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-scheduler-'))
const repo = join(root, 'repo')
mkdirSync(repo)
// -b main: the workspace row says `main`, and a runner whose git defaults to
// `master` would read as branch drift and refuse the unattended fire.
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 'scheduler@example.test'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'Scheduler Test'], { cwd: repo })
execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: repo })

const cwdBefore = process.cwd()
process.chdir(root)
const vite = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
})
const { getDb, closeDb } = (await vite.ssrLoadModule(
  '/src/server/db.ts',
)) as typeof import('./db.ts')
const { syncTask, unscheduleTask } = (await vite.ssrLoadModule(
  '/src/server/scheduler.ts',
)) as typeof import('./scheduler.ts')

after(async () => {
  closeDb()
  await vite.close()
  process.chdir(cwdBefore)
  rmSync(root, { recursive: true, force: true })
})

function seedTask(id: string, scheduledAt: number) {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO runtimes
       (id, label, bin, argsTemplate, promptViaStdin, description, enabled, canOpenPrs, transport, createdAt)
     VALUES ('test-shell', 'Test shell', ?, ?, 0, '', 1, 0, 'cli', 1)`,
  ).run(process.execPath, JSON.stringify(['-e', "process.stdout.write('done')"]))
  db.prepare(
    `INSERT OR REPLACE INTO projects
       (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
     VALUES ('project-1', 'Project', 'project', ?, 'main', '', 0, '', ?, 1)`,
  ).run(
    repo,
    JSON.stringify([
      {
        id: 'test-check',
        name: 'test check',
        command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      },
    ]),
  )
  db.prepare(
    `INSERT OR REPLACE INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, createdAt, archivedAt)
     VALUES ('workspace-1', 'project-1', 'main', 'main', ?, 'main', 'ready', '', NULL, 1, NULL)`,
  ).run(repo)
  db.prepare(
    `INSERT INTO tasks
       (id, name, description, runtimeId, prompt, cwd, workspaceId, cron, enabled,
        model, effort, webhookIntegrationId, webhookEvents, webhookFilters,
        verifyEnabled, maxRepairAttempts, timeoutMs, resumeSessionId,
        resumeSessionLabel, fireOnce, scheduledAt, requireIsolation, requireGhAuth,
        createdAt, updatedAt, lastRunAt)
     VALUES (?, 'One shot', '', 'test-shell', 'work', ?, 'workspace-1', '* * * * *', 1,
             '', '', '', '[]', '{}', 1, 0, 0, '', '', 1, ?, 0, 0, 1, 1, NULL)`,
  ).run(id, repo, scheduledAt)
}

async function waitForFire(taskId: string): Promise<ScheduleFireRow> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const row = getDb()
      .prepare('SELECT * FROM schedule_fires WHERE taskId = ? ORDER BY observedAt DESC LIMIT 1')
      .get(taskId) as ScheduleFireRow | undefined
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${taskId}`)
}

async function waitForRunFinished(runId: string): Promise<void> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (row && row.status !== 'running') return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${runId}`)
}

describe('scheduler one-shots', () => {
  it('fires an absolute one-shot once and disables it', async () => {
    const taskId = 'future-once'
    seedTask(taskId, Date.now() + 100)
    syncTask(taskId)

    const fire = await waitForFire(taskId)
    assert.equal(fire.outcome, 'started')
    assert.ok(fire.runId)
    const task = getDb().prepare('SELECT enabled FROM tasks WHERE id = ?').get(taskId) as {
      enabled: number
    }
    assert.equal(task.enabled, 0)
    await waitForRunFinished(fire.runId)
    unscheduleTask(taskId)
  })

  it('catches up a one-shot shortly after restart', async () => {
    const taskId = 'recent-once'
    seedTask(taskId, Date.now() - 100)
    syncTask(taskId)

    const fire = await waitForFire(taskId)
    assert.equal(fire.outcome, 'started')
    await waitForRunFinished(fire.runId)
    unscheduleTask(taskId)
  })

  it('records an old one-shot as missed instead of moving it to tomorrow', async () => {
    const taskId = 'missed-once'
    seedTask(taskId, Date.now() - 20 * 60_000)
    syncTask(taskId)

    const fire = await waitForFire(taskId)
    assert.equal(fire.outcome, 'missed')
    assert.match(fire.detail, /15-minute/)
    const task = getDb().prepare('SELECT enabled FROM tasks WHERE id = ?').get(taskId) as {
      enabled: number
    }
    assert.equal(task.enabled, 0)
  })
})
