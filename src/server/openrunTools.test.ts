/**
 * The tool server reads the database and the run's worktree, so these tests use
 * a throwaway OPENRUN_HOME and a real one-commit repo.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'openrun-tools-'))
const repo = mkdtempSync(join(tmpdir(), 'openrun-tools-repo-'))
const cwdBefore = process.cwd()
const previousHome = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = join(root, '.openrun')
process.chdir(root)

const { getDb, closeDb } = await import('./db.ts')
const { callOpenrunTool } = await import('./openrunTools.ts')

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
}

function seed(): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, name, slug, path, createdAt, checks)
     VALUES ('proj_1', 'Open Run', 'open-run', ?, ?, ?)`,
  ).run(repo, now, JSON.stringify([{ name: 'tests', command: 'pnpm test' }]))
  db.prepare(
    `INSERT INTO workspaces (id, projectId, name, branch, path, createdAt)
     VALUES ('ws_1', 'proj_1', 'main', 'main', ?, ?)`,
  ).run(repo, now)
  db.prepare(
    `INSERT INTO tasks (id, name, runtimeId, prompt, cwd, cron, createdAt, updatedAt)
     VALUES ('task_1', 'Nightly tidy', 'rt_1', 'Tidy the tree', ?, '0 3 * * *', ?, ?)`,
  ).run(repo, now, now)

  const insertRun = db.prepare(
    `INSERT INTO runs (id, taskId, taskName, runtimeId, trigger, status, command, cwd,
                       startedAt, finishedAt, baseBranch, baseSnapshot, workspaceId,
                       model, effort, runtimeMode, verdict)
     VALUES (@id, @taskId, @taskName, 'rt_1', @trigger, @status, 'claude -p', @cwd,
             @startedAt, @finishedAt, 'main', @baseSnapshot, @workspaceId,
             @model, @effort, @runtimeMode, @verdict)`,
  )
  insertRun.run({
    id: 'run_now',
    taskId: 'task_1',
    taskName: 'Nightly tidy',
    trigger: 'schedule',
    status: 'running',
    cwd: repo,
    startedAt: now,
    finishedAt: null,
    baseSnapshot: git('rev-parse', 'HEAD').trim(),
    workspaceId: 'ws_1',
    model: 'claude-opus-5',
    effort: 'high',
    runtimeMode: 'full-access',
    verdict: '',
  })
  insertRun.run({
    id: 'run_old',
    taskId: 'task_1',
    taskName: 'Nightly tidy',
    trigger: 'schedule',
    status: 'error',
    cwd: repo,
    startedAt: now - 86_400_000,
    finishedAt: now - 86_300_000,
    baseSnapshot: '',
    workspaceId: 'ws_1',
    model: 'claude-opus-5',
    effort: 'high',
    runtimeMode: 'full-access',
    verdict: 'failed',
  })
  insertRun.run({
    id: 'run_chat',
    taskId: null,
    taskName: 'Chat',
    trigger: 'manual',
    status: 'running',
    cwd: repo,
    startedAt: now,
    finishedAt: null,
    baseSnapshot: '',
    workspaceId: '',
    model: '',
    effort: '',
    runtimeMode: 'read-only',
    verdict: '',
  })
}

before(() => {
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.')
  git('commit', '-qm', 'first')
  seed()
})

after(() => {
  closeDb()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
  rmSync(repo, { recursive: true, force: true })
})

describe('callOpenrunTool', () => {
  it('refuses a tool it does not offer', () => {
    const result = callOpenrunTool({ name: 'delete_everything', args: {}, runId: 'run_now' })
    assert.equal(result.isError, true)
    assert.match(result.text, /Unknown tool/)
  })

  it('explains itself when the server was started outside a run', () => {
    const result = callOpenrunTool({ name: 'run_context', args: {}, runId: '' })
    assert.equal(result.isError, true)
    assert.match(result.text, /only works inside an Open Run run/)
  })

  it('says so when the run id belongs to another database', () => {
    const result = callOpenrunTool({ name: 'run_context', args: {}, runId: 'run_nope' })
    assert.equal(result.isError, true)
    assert.match(result.text, /not in this Open Run database/)
  })
})

describe('run_context', () => {
  it('reports the automation, workspace, and the checks the run will be judged by', () => {
    const result = callOpenrunTool({ name: 'run_context', args: {}, runId: 'run_now' })
    assert.equal(result.isError, undefined)
    assert.equal(result.data.automation, 'Nightly tidy')
    assert.equal(result.data.trigger, 'schedule')
    assert.equal(result.data.workspace, repo)
    assert.equal(result.data.schedule, '0 3 * * *')
    assert.deepEqual(result.data.verificationChecks, [{ name: 'tests', command: 'pnpm test' }])
    assert.match(result.text, /Automation: Nightly tidy/)
    assert.match(result.text, /- tests: pnpm test/)
  })

  it('says plainly when a project has no checks configured', () => {
    const result = callOpenrunTool({ name: 'run_context', args: {}, runId: 'run_chat' })
    assert.deepEqual(result.data.verificationChecks, [])
    assert.match(result.text, /No verification checks are configured/)
  })

  it('resolves the access mode to the label the UI shows, not the stored key', () => {
    const result = callOpenrunTool({ name: 'run_context', args: {}, runId: 'run_chat' })
    assert.notEqual(result.data.accessMode, 'read-only')
    assert.ok(String(result.data.accessMode).length > 0)
  })
})

describe('changed_files', () => {
  it('compares against the commit the run started from, not the last commit', () => {
    writeFileSync(join(repo, 'README.md'), '# repo\n\nedited\n')
    writeFileSync(join(repo, 'NOTES.md'), 'new file\n')
    git('add', '.')
    git('commit', '-qm', 'second')

    const result = callOpenrunTool({ name: 'changed_files', args: {}, runId: 'run_now' })
    const files = result.data.files as Array<{ path: string; status: string }>
    assert.deepEqual(files.map((f) => f.path).sort(), ['NOTES.md', 'README.md'])
    assert.match(result.text, /NOTES\.md/)
  })

  it('says nothing has changed rather than returning an empty blob', () => {
    const result = callOpenrunTool({ name: 'changed_files', args: {}, runId: 'run_chat' })
    assert.deepEqual(result.data.files, [])
    assert.match(result.text, /No files have changed/)
  })
})

describe('recent_runs', () => {
  it('returns the earlier runs of the same automation, excluding this one', () => {
    const result = callOpenrunTool({ name: 'recent_runs', args: {}, runId: 'run_now' })
    const runs = result.data.runs as Array<{ id: string; status: string; verdict: string | null }>
    assert.deepEqual(
      runs.map((r) => [r.id, r.status, r.verdict]),
      [['run_old', 'error', 'failed']],
    )
    assert.match(result.text, /error \(failed\)/)
  })

  it('clamps a limit outside the schema instead of failing the call', () => {
    for (const limit of [0, -5, 500, 'lots']) {
      const result = callOpenrunTool({ name: 'recent_runs', args: { limit }, runId: 'run_now' })
      assert.equal(result.isError, undefined, String(limit))
    }
  })

  it('has no history to offer for a one-off chat', () => {
    const result = callOpenrunTool({ name: 'recent_runs', args: {}, runId: 'run_chat' })
    assert.deepEqual(result.data.runs, [])
    assert.match(result.text, /one-off chat/)
  })
})
