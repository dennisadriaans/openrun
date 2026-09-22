import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { connect } from 'node:net'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../openrun.ts', import.meta.url))
const worker = fileURLToPath(new URL('../worker.ts', import.meta.url))
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('standalone CLI persists, schedules and executes without the web server', {
  timeout: 90_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'openrun-cli-'))
  const repo = join(root, 'repo')
  const home = join(root, 'state')
  mkdirSync(repo)
  const env = {
    ...process.env,
    OPENRUN_HOME: home,
    OPENRUN_CLOUD_URL: 'off',
    OPENRUN_URL: '',
    AGENTOPS_URL: '',
  }
  const command = async (...args: string[]) => {
    const { stdout } = await exec(
      process.execPath,
      ['--experimental-strip-types', cli, ...args, '--json'],
      { cwd: repo, env },
    )
    return JSON.parse(stdout)
  }
  const call = (operation: string, input?: unknown) =>
    command('api', operation, ...(input === undefined ? [] : [JSON.stringify(input)]))
  async function eventually(check: () => Promise<boolean>) {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await check()) return
      await pause(100)
    }
    assert.fail('Timed out waiting for local runtime state')
  }
  try {
    assert.deepEqual(await command('worker', 'status'), { running: false })
    // Racing first invocations must elect only one owner, not duplicate cron.
    assert.deepEqual(await Promise.all([command('ls'), command('ls')]), [[], []])
    const status = await command('worker', 'status')
    assert.equal(status.kind, 'worker')
    assert.equal(statSync(join(home, 'ipc', 'runtime.json')).mode & 0o777, 0o600)
    await assert.rejects(
      exec(process.execPath, ['--experimental-strip-types', worker], { env }),
      /already owns this database/,
    )
    assert.equal((await command('worker', 'status')).pid, status.pid)
    // The private IPC listener cannot dispatch a request without its credential.
    const endpoint = JSON.parse(readFileSync(join(home, 'ipc', 'runtime.json'), 'utf8'))
    const refusal = await new Promise<string>((resolve, reject) => {
      const socket = connect({ port: endpoint.port, host: '127.0.0.1' })
      socket.on('error', reject)
      socket.on('connect', () =>
        socket.write(`${JSON.stringify({ operation: 'tasks.list', token: 'wrong' })}\n`),
      )
      socket.once('data', (data) => {
        socket.destroy()
        resolve(String(data))
      })
    })
    assert.match(refusal, /Unauthorized/)

    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ],
      { cwd: repo },
    )
    const project = await command('init', '--check', 'exit 0')
    assert.equal((await command('init')).id, project.id)
    const runtime = await call('runtimes.save', {
      label: 'Fixture',
      bin: process.execPath,
      argsTemplate: JSON.stringify(['-e', 'setTimeout(() => console.log("fixture done"), 100)']),
      description: 'Offline test runtime',
      promptViaStdin: true,
      enabled: true,
      canOpenPrs: false,
      transport: 'cli',
    })
    const workspaces = await call('workspaces.list', {})
    const workspaceId = workspaces[0].id
    const preview = await command(
      'schedule',
      'every',
      'day',
      'at',
      '9',
      'fixture task',
      '--runtime',
      runtime.id,
      '--dry-run',
    )
    assert.equal(preview.runtimeId, runtime.id)
    assert.deepEqual(await command('ls'), [])
    const task = await command(
      'schedule',
      'every',
      'day',
      'at',
      '9',
      'fixture task',
      '--runtime',
      runtime.id,
      '--name',
      'daily-fixture',
    )
    assert.equal((await command('automations', 'list'))[0].id, task.id)
    await command('disable', task.id)
    assert.equal((await command('ls'))[0].enabled, 0)
    await command('enable', task.id)
    assert.equal((await command('ls'))[0].enabled, 1)
    await command('disable', task.id)
    // Persist an imminent one-shot, then let the creating CLI exit.
    const once = await call('tasks.save', {
      name: 'one-shot',
      description: '',
      cwd: repo,
      runtimeId: runtime.id,
      workspaceId,
      prompt: 'fixture task',
      cron: '0 9 * * *',
      fireOnce: true,
      scheduledAt: Date.now() + 1_500,
      enabled: true,
    })
    await eventually(async () =>
      (await command('runs')).some(
        (run: { taskId: string; status: string }) =>
          run.taskId === once.id && run.status === 'success',
      ),
    )
    const runs = await command('runs')
    assert.equal(runs.filter((run: { taskId: string }) => run.taskId === once.id).length, 1)
    assert.equal((await command('ls')).find((row: { id: string }) => row.id === once.id).enabled, 0)
    assert.equal((await command('show', runs[0].id)).run.id, runs[0].id)

    const started = await command('run', 'manual fixture', '--runtime', runtime.id)
    await eventually(
      async () => (await call('runs.get', { id: started.runId })).status === 'success',
    )
    assert.equal(
      (await command('integrations', 'providers')).some((p: { id: string }) => p.id === 'github'),
      true,
    )
    // Local binding/setup is the same operation as the UI; vendor authorization
    // is separately tested with a loopback fake, never real credentials.
    const integration = await call('integrations.create', {
      provider: 'github',
      name: 'Fixture connection',
    })
    const providers = await command('integrations', 'providers')
    const event = providers.find((p: { id: string }) => p.id === 'github').events[0].id
    const binding = await command(
      'integrations',
      'configure',
      integration.id,
      '--runtime',
      runtime.id,
      '--in',
      workspaceId,
      '--event',
      event,
      '--prompt',
      'integration fixture',
    )
    assert.ok(binding.taskId)
    await command('integrations', 'disable', integration.id)
    assert.equal((await command('integrations'))[0].enabled, 0)
    await assert.rejects(command('integrations', 'connect', 'github'), /require Open Run Cloud/)
    await assert.rejects(command('ls', '--limit', 'invalid'), /positive integer/)
    await assert.rejects(command('rm', task.id, '--dry-run'), /supported by/)
    await assert.rejects(command('ls', '--url', 'http://127.0.0.1:1'), /not answering/)
    assert.equal((await command('worker', 'status')).pid, status.pid)

    await command('worker', 'stop')
    await eventually(async () => (await command('worker', 'status')).running === false)
    assert.ok((await command('runs')).some((run: { id: string }) => run.id === started.runId))
    assert.notEqual((await command('worker', 'status')).pid, status.pid)
  } finally {
    await command('worker', 'stop').catch(() => {})
    await eventually(async () => (await command('worker', 'status')).running === false).catch(
      () => {},
    )
    rmSync(root, { recursive: true, force: true })
  }
})
