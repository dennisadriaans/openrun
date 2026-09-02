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
const worktree = join(root, 'worktree')
mkdirSync(repo)
// -b main: the workspace row says `main`, and a runner whose git defaults to
// `master` would read as branch drift and refuse the unattended fire.
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 'scheduler@example.test'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'Scheduler Test'], { cwd: repo })
execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: repo })
execFileSync('git', ['worktree', 'add', '-q', '-b', 'openrun/scheduler', worktree, 'main'], {
  cwd: repo,
})

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
const { getDb, closeDb } = (await vite.ssrLoadModule(
  '/src/server/db.ts',
)) as typeof import('./db.ts')
const { bootScheduler, syncTask, unscheduleTask } = (await vite.ssrLoadModule(
  '/src/server/scheduler.ts',
)) as typeof import('./scheduler.ts')

after(async () => {
  closeDb()
  await vite.close()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
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
     VALUES ('workspace-1', 'project-1', 'scheduler', 'openrun/scheduler', ?, 'worktree', 'ready', '', NULL, 1, NULL)`,
  ).run(worktree)
  db.prepare(
    `INSERT INTO tasks
       (id, name, description, runtimeId, prompt, cwd, workspaceId, cron, enabled,
        model, effort, webhookIntegrationId, webhookEvents, webhookFilters,
        verifyEnabled, maxRepairAttempts, timeoutMs, resumeSessionId,
        resumeSessionLabel, fireOnce, scheduledAt, requireIsolation, requireGhAuth,
        createdAt, updatedAt, lastRunAt)
     VALUES (?, 'One shot', '', 'test-shell', 'work', ?, 'workspace-1', '* * * * *', 1,
             '', '', '', '[]', '{}', 1, 0, 0, '', '', 1, ?, 0, 0, 1, 1, NULL)`,
  ).run(id, worktree, scheduledAt)
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

/** A recurring (not fire-once) automation whose schedule was last seen at `updatedAt`. */
function seedRecurringTask(id: string, cron: string, updatedAt: number) {
  seedTask(id, 0)
  getDb()
    .prepare('UPDATE tasks SET cron = ?, fireOnce = 0, enabled = 1, updatedAt = ? WHERE id = ?')
    .run(cron, updatedAt, id)
}

/** A daily cron whose most recent occurrence was exactly `hoursAgo` ago. */
function dailyCronHoursAgo(hoursAgo: number): string {
  const at = new Date(Date.now() - hoursAgo * 60 * 60_000)
  return `${at.getMinutes()} ${at.getHours()} * * *`
}

/** `bootScheduler` is a once-per-process guard; tests need it to run again. */
function reboot() {
  ;(globalThis as { __agentopsBooted?: boolean }).__agentopsBooted = false
  bootScheduler()
}

describe('recurring fires missed while Open Run was down', () => {
  it('records an overnight gap as a missed fire instead of losing it', async () => {
    const db = getDb()
    db.exec('DELETE FROM tasks; DELETE FROM schedule_fires')
    const taskId = 'nightly'
    // Due six hours ago and last seen two days ago: two occurrences went by,
    // and the newest is far outside the catch-up window.
    seedRecurringTask(taskId, dailyCronHoursAgo(6), Date.now() - 48 * 60 * 60_000)

    try {
      reboot()
      const fire = await waitForFire(taskId)
      assert.equal(fire.outcome, 'missed')
      assert.match(fire.detail, /was not running/)
      assert.match(fire.detail, /2 runs/)
      assert.match(fire.detail, /6 hours ago/)
    } finally {
      unscheduleTask(taskId)
    }
  })

  it('catches up a recurring fire that was only just missed', async () => {
    const db = getDb()
    db.exec('DELETE FROM tasks; DELETE FROM schedule_fires')
    const taskId = 'just-missed'
    // Due five minutes ago — inside the grace window, so it still runs.
    const at = new Date(Date.now() - 5 * 60_000)
    seedRecurringTask(taskId, `${at.getMinutes()} ${at.getHours()} * * *`, Date.now() - 60 * 60_000)

    try {
      reboot()
      const fire = await waitForFire(taskId)
      assert.equal(fire.outcome, 'started')
      assert.match(fire.detail, /running now/)
      await waitForRunFinished(fire.runId)
    } finally {
      unscheduleTask(taskId)
    }
  })

  it('says nothing for an automation that never missed a beat', async () => {
    const db = getDb()
    db.exec('DELETE FROM tasks; DELETE FROM schedule_fires')
    const taskId = 'fresh'
    // Saved a moment ago, next due in the small hours: nothing in between.
    seedRecurringTask(taskId, dailyCronHoursAgo(-3), Date.now() - 1_000)

    try {
      reboot()
      await new Promise((resolve) => setTimeout(resolve, 200))
      const rows = db
        .prepare('SELECT COUNT(*) AS n FROM schedule_fires WHERE taskId = ?')
        .get(taskId) as { n: number }
      assert.equal(rows.n, 0)
    } finally {
      unscheduleTask(taskId)
    }
  })
})
