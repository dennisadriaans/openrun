import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createServer } from 'vite'
import type { RunRow } from './db.ts'

const appRoot = process.cwd()
const root = mkdtempSync(join(tmpdir(), 'openrun-executions-'))
const previous = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = join(root, 'home')
process.chdir(root)
const vite = await createServer({
  root: appRoot,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
})
const dbModule = (await vite.ssrLoadModule('/src/server/db.ts')) as typeof import('./db.ts')
const core = (await vite.ssrLoadModule('/src/server/core.ts')) as typeof import('./core.ts')
const environments = (await vite.ssrLoadModule(
  '/src/server/runEnvironment.ts',
)) as typeof import('./runEnvironment.ts')
const executor = (await vite.ssrLoadModule(
  '/src/server/executor.ts',
)) as typeof import('./executor.ts')
const workspaces = (await vite.ssrLoadModule(
  '/src/server/workspaces.ts',
)) as typeof import('./workspaces.ts')
const db = dbModule.getDb()
let sequence = 0

function git(repo: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

async function fixture(script = 'process.exit(0)', setupCommand = '') {
  const n = ++sequence
  const repo = join(root, `repo-${n}`)
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'Execution Test')
  git(repo, 'config', 'user.email', 'execution@example.test')
  writeFileSync(join(repo, 'source.txt'), 'base\n')
  git(repo, 'add', 'source.txt')
  git(repo, 'commit', '-qm', 'initial')
  const project = await workspaces.addProject({ mode: 'register', path: repo, setupCommand })
  const workspace = workspaces.listWorkspaces(project.id).find((w) => w.kind === 'main')!
  const runtimeId = `execution-runtime-${n}`
  db.prepare(`INSERT INTO runtimes (id, label, bin, argsTemplate, promptViaStdin, description, enabled, createdAt)
    VALUES (?, 'Test runtime', ?, ?, 0, '', 1, 1)`).run(
    runtimeId,
    process.execPath,
    JSON.stringify(['-e', script]),
  )
  const task = core.upsertTask({
    name: `Test ${n}`,
    description: '',
    runtimeId,
    prompt: 'test the execution',
    cwd: '',
    workspaceId: workspace.id,
    cron: '',
    enabled: false,
    verifyEnabled: false,
  })
  return { repo, project, workspace, runtimeId, task, base: git(repo, 'rev-parse', 'HEAD') }
}

async function terminal(runId: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow
    if (run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Run did not finish: ${runId}`)
}

after(async () => {
  executor.cancelAllLiveRuns()
  const timer = (globalThis as { __openrunMcpTokenTimer?: NodeJS.Timeout }).__openrunMcpTokenTimer
  if (timer) clearInterval(timer)
  dbModule.closeDb()
  await vite.close()
  if (previous === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previous
  process.chdir(appRoot)
  rmSync(root, { recursive: true, force: true })
})

test('manual starts reuse the current branch and dirty checkout without adding resources', async () => {
  const f = await fixture("require('fs').writeFileSync('source.txt', 'edited by run\\n')")
  git(f.repo, 'checkout', '-qb', 'developer-branch')
  writeFileSync(join(f.repo, 'local-only.txt'), 'uncommitted editor work')
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM workspaces').get() as { n: number }).n
  const before = count()
  for (let entry = 0; entry < 2; entry++) {
    const { runId } = core.startChat({
      workspaceId: f.workspace.id,
      runtimeId: f.runtimeId,
      prompt: 'edit the project',
    })
    const run = await terminal(runId)
    assert.equal(run.cwd, f.workspace.path)
    assert.equal(run.baseBranch, 'developer-branch')
    assert.equal(environments.getRunEnvironment(runId), undefined)
  }
  assert.equal(count(), before)
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length, 1)
  assert.equal(readFileSync(join(f.repo, 'local-only.txt'), 'utf8'), 'uncommitted editor work')
})

test('two automation invocations run independently from the same clean base while the editor is dirty', async () => {
  const f = await fixture(
    "require('fs').writeFileSync('result.txt', 'run output'); setTimeout(() => {}, 350)",
  )
  writeFileSync(join(f.repo, 'source.txt'), 'editor changes')
  writeFileSync(join(f.repo, 'local-only.txt'), 'private local work')
  const one = core.runTaskNow(f.task.id).runId
  const two = core.runTaskNow(f.task.id).runId
  const e1 = environments.getRunEnvironment(one)!
  const e2 = environments.getRunEnvironment(two)!
  assert.notEqual(e1.path, e2.path)
  assert.notEqual(e1.branch, e2.branch)
  assert.equal(e1.baseCommit, f.base)
  assert.equal(e2.baseCommit, f.base)
  assert.equal(readFileSync(join(e1.path, 'source.txt'), 'utf8'), 'base\n')
  assert.equal(existsSync(join(e1.path, 'local-only.txt')), false)
  environments.collectRunEnvironments()
  assert.equal(existsSync(e1.path), true)
  assert.equal(existsSync(e2.path), true)
  assert.equal((await terminal(one)).status, 'success')
  assert.equal((await terminal(two)).status, 'success')
  assert.equal(readFileSync(join(f.repo, 'source.txt'), 'utf8'), 'editor changes')
  assert.equal(workspaces.listWorkspaces(f.project.id).length, 1)
  assert.equal(environments.getRunEnvironment(one)!.state, 'released')
  assert.equal(environments.getRunEnvironment(two)!.state, 'released')
})

test('successful results, diffs and files survive cleanup and browsing does not recreate directories', async () => {
  const f = await fixture("require('fs').writeFileSync('result.txt', 'saved result\\n')")
  const runId = core.runTaskNow(f.task.id).runId
  await terminal(runId)
  const env = environments.getRunEnvironment(runId)!
  assert.equal(env.state, 'released')
  assert.equal(existsSync(env.path), false)
  assert.equal(git(f.repo, 'show', `${env.resultCommit}:result.txt`), 'saved result')
  assert.equal(git(f.repo, 'rev-parse', `refs/heads/${env.branch}`), env.resultCommit)
  const view = await core.getRunWorkspace(runId)
  assert.equal(view?.files[0]?.path, 'result.txt')
  assert.equal(core.readWorkspaceFile({ runId, path: 'result.txt' }).content, 'saved result\n')
  assert.equal(
    core.listWorkspaceFiles({ runId }).entries.some((e) => e.name === 'result.txt'),
    true,
  )
  assert.match(environments.resultFileDiff(env, 'result.txt', 3), /\+saved result/)
  assert.equal(existsSync(env.path), false)
  assert.throws(() => core.readWorkspaceFile({ runId, path: '../secret' }), /escapes/)
  environments.collectRunEnvironments()
  assert.equal(environments.ensureRunEnvironment(runId), true)
  assert.equal(readFileSync(join(env.path, 'result.txt'), 'utf8'), 'saved result\n')
  environments.releaseRunEnvironment(runId)
  assert.equal(existsSync(env.path), false)
})

test('a follow-up restores the saved result and releases the execution directory again', async () => {
  const f = await fixture()
  const claude = join(root, `claude-${sequence}`)
  writeFileSync(
    claude,
    `#!${process.execPath}\nconst fs = require('fs'); const cp = require('child_process'); fs.appendFileSync('turns.txt', fs.existsSync('turns.txt') ? 'follow-up\\n' : 'opening\\n'); cp.execFileSync('git', ['add', 'turns.txt']); cp.execFileSync('git', ['commit', '-qm', 'record turn'])\n`,
  )
  chmodSync(claude, 0o755)
  db.prepare('UPDATE runtimes SET bin = ?, argsTemplate = ? WHERE id = ?').run(
    claude,
    '[]',
    f.runtimeId,
  )
  const runId = core.runTaskNow(f.task.id).runId
  await terminal(runId)
  const env = environments.getRunEnvironment(runId)!
  assert.equal(env.state, 'released')
  assert.equal(existsSync(env.path), false)

  const sent = core.postMessage({ runId, prompt: 'continue the work' })
  assert.equal(sent.queued, false)
  const followUp = await terminal(runId)
  assert.equal(followUp.status, 'success', followUp.stderr)
  const resumed = environments.getRunEnvironment(runId)!
  assert.equal(resumed.state, 'released')
  assert.equal(existsSync(resumed.path), false)
  assert.equal(git(f.repo, 'show', `${resumed.resultCommit}:turns.txt`), 'opening\nfollow-up')
})

test('repeat uses the original base in a new directory after the automation is deleted', async () => {
  const f = await fixture()
  const first = core.runTaskNow(f.task.id).runId
  await terminal(first)
  writeFileSync(join(f.repo, 'source.txt'), 'new base')
  git(f.repo, 'commit', '-qam', 'advance base')
  core.deleteTask(f.task.id)
  const second = core.repeatRun(first).runId
  assert.equal(environments.getRunEnvironment(second)!.baseCommit, f.base)
  assert.notEqual(
    environments.getRunEnvironment(second)!.path,
    environments.getRunEnvironment(first)!.path,
  )
  await terminal(second)
})

test('failure preserves partial output without contaminating the next invocation', async () => {
  const f = await fixture(
    "require('fs').writeFileSync('partial.txt', 'recover me'); process.exit(2)",
  )
  const runId = core.runTaskNow(f.task.id).runId
  assert.equal((await terminal(runId)).status, 'error')
  const result = environments.getRunEnvironment(runId)!
  assert.equal(git(f.repo, 'show', `${result.resultCommit}:partial.txt`), 'recover me')
  const retry = core.runTaskNow(f.task.id).runId
  assert.equal(environments.getRunEnvironment(retry)!.baseCommit, f.base)
  await terminal(retry)
})

test('cancellation retains uncommitted output until an explicit discard', async () => {
  const f = await fixture(
    "require('fs').writeFileSync('partial.txt', 'recover me'); setTimeout(() => {}, 30000)",
  )
  const runId = core.runTaskNow(f.task.id).runId
  const env = environments.getRunEnvironment(runId)!
  const deadline = Date.now() + 5000
  while (!existsSync(join(env.path, 'partial.txt')) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(executor.cancelRun(runId), true)
  assert.equal((await terminal(runId)).status, 'cancelled')
  assert.equal(readFileSync(join(env.path, 'partial.txt'), 'utf8'), 'recover me')
  environments.collectRunEnvironments()
  assert.equal(existsSync(env.path), true)
  core.discardChanges({ runId })
  assert.equal(environments.getRunEnvironment(runId)!.state, 'released')
  assert.equal(existsSync(env.path), false)
})

test('setup failure and cancellation are recorded as part of the run', async () => {
  const f = await fixture('process.exit(0)', `${process.execPath} -e "process.exit(2)"`)
  const failed = core.runTaskNow(f.task.id).runId
  assert.equal((await terminal(failed)).status, 'error')
  assert.match(core.getRun(failed)!.stderr, /setup failed/)
  workspaces.updateProject({
    id: f.project.id,
    setupCommand: `${process.execPath} -e "setTimeout(() => {}, 30000)"`,
  })
  const cancelled = core.runTaskNow(f.task.id).runId
  executor.cancelRun(cancelled)
  assert.equal((await terminal(cancelled)).status, 'cancelled')
  assert.equal(
    db.prepare("SELECT id FROM messages WHERE runId = ? AND role = 'assistant'").get(cancelled),
    undefined,
  )
})

test('setup artifacts are recorded and retained when the agent changes them', async () => {
  const f = await fixture(
    "require('fs').writeFileSync('node_modules/setup.txt', 'changed by agent')",
  )
  writeFileSync(join(f.repo, '.gitignore'), 'node_modules/\n')
  git(f.repo, 'add', '.gitignore')
  git(f.repo, 'commit', '-qm', 'ignore dependencies')
  workspaces.updateProject({
    id: f.project.id,
    setupCommand: `${process.execPath} -e "require('fs').mkdirSync('node_modules'); require('fs').writeFileSync('node_modules/setup.txt', 'from setup')"`,
  })

  const runId = core.runTaskNow(f.task.id).runId
  await terminal(runId)
  const env = environments.getRunEnvironment(runId)!
  assert.match(env.setupArtifacts, /node_modules/)
  assert.equal(env.state, 'retained')
  assert.equal(readFileSync(join(env.path, 'node_modules/setup.txt'), 'utf8'), 'changed by agent')
})

test('cleanup respects leases, worktree locks, ignored user files and external processes', async () => {
  const f = await fixture()
  const runId = core.runTaskNow(f.task.id).runId
  await terminal(runId)
  environments.ensureRunEnvironment(runId)
  const env = environments.getRunEnvironment(runId)!
  const release = environments.holdRunEnvironment(runId)
  environments.collectRunEnvironments()
  assert.equal(existsSync(env.path), true)
  release()
  git(f.repo, 'worktree', 'lock', env.path)
  environments.releaseRunEnvironment(runId)
  assert.equal(existsSync(env.path), true)
  git(f.repo, 'worktree', 'unlock', env.path)
  writeFileSync(join(env.path, '.env'), 'user secret')
  writeFileSync(join(env.gitDir, 'info-exclude-test'), '')
  git(env.path, 'config', 'core.excludesFile', join(root, 'ignore-test'))
  writeFileSync(join(root, 'ignore-test'), '.env\n')
  environments.releaseRunEnvironment(runId)
  assert.equal(readFileSync(join(env.path, '.env'), 'utf8'), 'user secret')
  // The fixture owns this file, and removes it to exercise the next refusal.
  rmSync(join(env.path, '.env'))
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    cwd: env.path,
    stdio: 'ignore',
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  environments.releaseRunEnvironment(runId)
  assert.equal(existsSync(env.path), true)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()
  await exited
  environments.releaseRunEnvironment(runId)
  assert.equal(existsSync(env.path), false)
})

test('restart reconciles orphan runs and safely collects journaled clean resources', async () => {
  const f = await fixture()
  const runId = core.runTaskNow(f.task.id).runId
  await terminal(runId)
  environments.ensureRunEnvironment(runId)
  const env = environments.getRunEnvironment(runId)!
  writeFileSync(join(env.path, 'recovery.txt'), 'crash output')
  db.prepare("UPDATE runs SET status = 'running', pid = NULL WHERE id = ?").run(runId)
  executor.reconcileOrphanRuns()
  assert.equal(core.getRun(runId)!.verdict, 'crashed')
  assert.equal(readFileSync(join(env.path, 'recovery.txt'), 'utf8'), 'crash output')
  // A creation that never acquired a run still has an ownership journal.
  const orphan = environments.createRunEnvironment('run_orphanclean', f.workspace.id)
  environments.collectRunEnvironments()
  assert.equal(existsSync(orphan.path), false)
  const uncertain = environments.createRunEnvironment('run_orphanunknown', f.workspace.id)
  rmSync(join(uncertain.gitDir, 'openrun-owner'))
  environments.collectRunEnvironments()
  assert.equal(existsSync(uncertain.path), true)
})

test('legacy migration preserves directories and known bases without importing external worktrees', async () => {
  const f = await fixture()
  const legacy = await workspaces.createWorkspace({ projectId: f.project.id, branch: 'legacy-run' })
  writeFileSync(join(legacy.path, 'user-work.txt'), 'preserve me')
  db.prepare('UPDATE tasks SET workspaceId = ?, cwd = ? WHERE id = ?').run(
    legacy.id,
    legacy.path,
    f.task.id,
  )
  environments.migrateAutomationTargets()
  const task = core.getTask(f.task.id)!
  assert.equal(task.workspaceId, f.workspace.id)
  assert.equal(task.baseRef, legacy.baseCommit)
  assert.equal(readFileSync(join(legacy.path, 'user-work.txt'), 'utf8'), 'preserve me')
  environments.migrateAutomationTargets()
  assert.equal(core.getTask(f.task.id)!.baseRef, legacy.baseCommit)
  const external = join(root, 'external')
  git(f.repo, 'worktree', 'add', '-qb', 'external', external)
  assert.equal(
    workspaces.listWorkspaces(f.project.id).some((w) => w.path === external),
    false,
  )
})
