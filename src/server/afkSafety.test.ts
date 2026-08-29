import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { createServer } from 'vite'
import type { CanonicalWebhookEvent } from '../lib/integrations/types.ts'
import type { RuntimeRow, TaskRow } from './db.ts'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-afk-safety-'))
const repo = join(root, 'repo')
const worktree = join(root, 'worktree')
mkdirSync(repo)
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
execFileSync('git', ['config', 'user.email', 'afk@example.test'], { cwd: repo })
execFileSync('git', ['config', 'user.name', 'AFK Test'], { cwd: repo })
execFileSync('git', ['commit', '--allow-empty', '-qm', 'initial'], { cwd: repo })
execFileSync('git', ['worktree', 'add', '-q', '-b', 'openrun/afk-test', worktree, 'main'], {
  cwd: repo,
})

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
const originalHome = process.env.HOME
const originalPath = process.env.PATH
const originalOpenrunHome = process.env.OPENRUN_HOME
process.env.HOME = root
process.env.PATH = '/usr/bin:/bin'
process.env.OPENRUN_HOME = join(root, 'openrun-home')
const core = (await vite.ssrLoadModule('/src/server/core.ts')) as typeof import('./core.ts')
const dispatcher = (await vite.ssrLoadModule(
  '/src/server/integrations/dispatcher.ts',
)) as typeof import('./integrations/dispatcher.ts')
const executor = (await vite.ssrLoadModule(
  '/src/server/executor.ts',
)) as typeof import('./executor.ts')
const { unattendedRefusal } = (await vite.ssrLoadModule(
  '/src/server/unattendedPreflight.ts',
)) as typeof import('./unattendedPreflight.ts')

after(async () => {
  const refreshTimer = (globalThis as { __openrunMcpTokenTimer?: NodeJS.Timeout })
    .__openrunMcpTokenTimer
  if (refreshTimer) clearInterval(refreshTimer)
  closeDb()
  await vite.close()
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
  if (originalOpenrunHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = originalOpenrunHome
  process.chdir(cwdBefore)
  rmSync(root, { recursive: true, force: true })
})

const check = {
  id: 'afk-check',
  name: 'AFK check',
  command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
}

function seed(options?: { checks?: boolean; kind?: 'main' | 'worktree' }) {
  const db = getDb()
  db.exec(
    'DELETE FROM check_results; DELETE FROM messages; DELETE FROM runs; DELETE FROM run_queue; DELETE FROM tasks; DELETE FROM webhook_deliveries; DELETE FROM integrations; DELETE FROM workspaces; DELETE FROM projects; DELETE FROM runtimes;',
  )
  db.prepare(
    `INSERT INTO runtimes
       (id, label, bin, argsTemplate, promptViaStdin, description, enabled, canOpenPrs, transport, createdAt)
     VALUES ('afk-runtime', 'AFK runtime', ?, ?, 0, '', 1, 0, 'cli', 1)`,
  ).run(process.execPath, JSON.stringify(['-e', 'process.exit(0)']))
  db.prepare(
    `INSERT INTO projects
       (id, name, slug, path, defaultBranch, remoteUrl, managed, setupCommand, checks, createdAt)
     VALUES ('afk-project', 'AFK project', 'afk-project', ?, 'main', '', 1, '', ?, 1)`,
  ).run(repo, options?.checks === false ? '[]' : JSON.stringify([check]))
  const kind = options?.kind ?? 'worktree'
  const path = kind === 'main' ? repo : worktree
  const branch = kind === 'main' ? 'main' : 'openrun/afk-test'
  const baseCommit = execFileSync('git', ['rev-parse', branch], {
    cwd: repo,
    encoding: 'utf8',
  }).trim()
  db.prepare(
    `INSERT INTO workspaces
       (id, projectId, name, branch, path, kind, status, setupLog, setupExitCode, baseCommit, createdAt, archivedAt)
     VALUES ('afk-workspace', 'afk-project', 'AFK workspace', ?, ?, ?, 'ready', '', NULL, ?, 1, NULL)`,
  ).run(branch, path, kind, baseCommit)
  db.prepare(
    `INSERT INTO integrations
       (id, provider, name, secret, config, enabled, createdAt, updatedAt)
     VALUES ('afk-integration', 'github', 'AFK integration', '', '{}', 1, 1, 1)`,
  ).run()
}

function taskInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'AFK task',
    description: '',
    runtimeId: 'afk-runtime',
    prompt: 'do work',
    cwd: '',
    workspaceId: 'afk-workspace',
    cron: '',
    enabled: false,
    webhookIntegrationId: '',
    webhookEvents: [],
    webhookFilters: {},
    verifyEnabled: true,
    requireIsolation: false,
    ...overrides,
  }
}

function event(deliveryId = `delivery-${Date.now()}`): CanonicalWebhookEvent {
  return {
    provider: 'github',
    eventType: 'issues.opened',
    deliveryId,
    occurredAt: null,
    issue: {
      id: 'issue-1',
      key: '#1',
      title: 'Issue',
      body: '',
      url: '',
      status: '',
      previousStatus: '',
      labels: [],
      assignees: [],
      project: '',
      priority: '',
    },
    actor: { name: 'Test', email: 'test@example.test' },
    extra: {},
  }
}

async function waitForTerminal(runId: string): Promise<string> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (row && row.status !== 'running') return row.status
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${runId}`)
}

describe('AFK safety core boundaries', () => {
  beforeEach(() => seed())

  it('uses the verification gate at save, enable, and final preflight', () => {
    assert.throws(
      () =>
        core.upsertTask(
          taskInput({
            enabled: true,
            webhookIntegrationId: 'afk-integration',
            verifyEnabled: false,
          }),
        ),
      /verification is disabled/i,
    )

    const webhookLater = core.upsertTask(taskInput({ enabled: true, verifyEnabled: false }))
    assert.throws(
      () =>
        core.updateTaskWebhook({
          taskId: webhookLater.id,
          webhookIntegrationId: 'afk-integration',
        }),
      /verification is disabled/i,
    )

    const task = core.upsertTask(
      taskInput({ webhookIntegrationId: 'afk-integration', verifyEnabled: true }),
    )
    getDb().prepare("UPDATE projects SET checks = '[]' WHERE id = 'afk-project'").run()
    assert.throws(() => core.setTaskEnabled(task.id, true), /at least one configured/i)

    const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow
    const runtime = getDb()
      .prepare('SELECT * FROM runtimes WHERE id = ?')
      .get('afk-runtime') as RuntimeRow
    assert.match(unattendedRefusal(row, runtime) ?? '', /at least one configured/i)
  })

  it('records a non-busy webhook start failure as an error and never queues it', async () => {
    const task = core.upsertTask(
      taskInput({ enabled: true, webhookIntegrationId: 'afk-integration' }),
    )
    // A malformed template is discovered by startRun after the complete
    // non-busy preflight. It must be a delivery error, not a busy retry.
    getDb().prepare("UPDATE runtimes SET argsTemplate = '[' WHERE id = 'afk-runtime'").run()

    const result = await dispatcher.ingestCanonicalEvent('afk-integration', event())
    assert.equal(result.status, 202)
    assert.match(JSON.stringify(result.body.errors), /Invalid args template/i)
    const delivery = getDb()
      .prepare('SELECT status, error FROM webhook_deliveries WHERE integrationId = ?')
      .get('afk-integration') as { status: string; error: string }
    assert.equal(delivery.status, 'error')
    assert.match(delivery.error, /Invalid args template/i)
    assert.equal(
      (getDb().prepare('SELECT COUNT(*) AS n FROM run_queue').get() as { n: number }).n,
      0,
    )
    assert.equal((getDb().prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n, 0)
    assert.ok(task.id)
  })

  it('enforces one enabled unattended owner through save, enable, and webhook update', () => {
    core.upsertTask(
      taskInput({
        name: 'First owner',
        enabled: true,
        webhookIntegrationId: 'afk-integration',
      }),
    )
    const second = core.upsertTask(
      taskInput({
        name: 'Second owner',
        enabled: false,
        webhookIntegrationId: 'afk-integration',
      }),
    )
    assert.throws(() => core.setTaskEnabled(second.id, true), /already assigned.*First owner/i)
    assert.throws(
      () =>
        core.upsertTask(
          taskInput({
            name: 'Third owner',
            enabled: true,
            webhookIntegrationId: 'afk-integration',
          }),
        ),
      /already assigned.*First owner/i,
    )

    const webhookLater = core.upsertTask(taskInput({ name: 'Webhook later', enabled: true }))
    assert.throws(
      () =>
        core.updateTaskWebhook({
          taskId: webhookLater.id,
          webhookIntegrationId: 'afk-integration',
        }),
      /already assigned.*First owner/i,
    )
  })

  it('quarantines AFK failures but leaves an attended manual failure reusable', async () => {
    const db = getDb()
    db.prepare("UPDATE runtimes SET argsTemplate = ? WHERE id = 'afk-runtime'").run(
      JSON.stringify(['-e', 'process.exit(2)']),
    )
    const runtime = db
      .prepare('SELECT * FROM runtimes WHERE id = ?')
      .get('afk-runtime') as RuntimeRow

    const manualId = executor.startRun({
      runtime,
      taskId: null,
      taskName: 'Manual',
      prompt: 'manual',
      cwd: worktree,
      workspaceId: 'afk-workspace',
      trigger: 'manual',
    })
    await waitForTerminal(manualId)
    assert.equal(
      (
        db.prepare('SELECT blockedKind FROM workspaces WHERE id = ?').get('afk-workspace') as {
          blockedKind: string
        }
      ).blockedKind,
      '',
    )

    const task = core.upsertTask(taskInput({ name: 'Scheduled failure', cron: '* * * * *' }))
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Parameters<
      typeof executor.runTask
    >[0]
    const scheduledId = executor.runTask(row, runtime, 'schedule')
    await waitForTerminal(scheduledId)
    assert.equal(
      (
        db.prepare('SELECT blockedKind FROM workspaces WHERE id = ?').get('afk-workspace') as {
          blockedKind: string
        }
      ).blockedKind,
      'run',
    )
  })

  it('rejects isolation while the task has either a running or queued row', () => {
    seed({ kind: 'main' })
    const task = core.upsertTask(taskInput({ name: 'Isolation task' }))
    const db = getDb()
    db.prepare(
      `INSERT INTO runs
       (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid,
        exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot)
       VALUES ('isolation-running', ?, 'Isolation', 'afk-runtime', 'manual', 'running', '', ?, 'afk-workspace', NULL,
               NULL, '', '', 1, NULL, '', 'main', '')`,
    ).run(task.id, repo)
    assert.throws(() => core.isolateTaskWorkspace(task.id), /run is in progress/i)

    db.prepare("DELETE FROM runs WHERE id = 'isolation-running'").run()
    db.prepare(
      `INSERT INTO run_queue
       (id, taskId, workspaceId, trigger, prompt, sourceProvider, sourceUrl, sourceLabel, scheduleFireId, queuedAt)
       VALUES ('isolation-queued', ?, 'afk-workspace', 'schedule', '', '', '', '', '', 1)`,
    ).run(task.id)
    assert.throws(() => core.isolateTaskWorkspace(task.id), /run is queued/i)
  })
})
