import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { CHECK_OUTPUT_TAIL_CHARS } from '../lib/checks.ts'
import { executeCheck } from './checks.ts'

const dirs: string[] = []

/** Quote a node invocation so `shell: true` works on Windows paths with spaces. */
function nodeFile(dir: string, name: string, source: string): string {
  const file = join(dir, name)
  writeFileSync(file, source)
  return `"${process.execPath}" "${file}"`
}

function workdir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentops-checks-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

describe('executeCheck', () => {
  it('passes on a zero exit and captures stdout', async () => {
    const dir = workdir()
    const result = await executeCheck({
      command: nodeFile(dir, 'ok.js', "process.stdout.write('all-green\\n')\n"),
      cwd: dir,
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'passed')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /all-green/)
  })

  it('fails on a non-zero exit and keeps the exit code', async () => {
    const dir = workdir()
    const result = await executeCheck({
      command: nodeFile(dir, 'fail.js', "console.error('boom'); process.exit(3)\n"),
      cwd: dir,
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.exitCode, 3)
    assert.match(result.output, /boom/)
  })

  it('captures stderr as well as stdout', async () => {
    const dir = workdir()
    const result = await executeCheck({
      command: nodeFile(
        dir,
        'both.js',
        "console.log('to-out'); console.error('to-err'); process.exit(1)\n",
      ),
      cwd: dir,
      timeoutMs: 30_000,
    })
    assert.match(result.output, /to-out/)
    assert.match(result.output, /to-err/)
  })

  it('runs in the given working directory', async () => {
    const dir = workdir()
    writeFileSync(join(dir, 'marker.txt'), 'here')
    const result = await executeCheck({
      command: nodeFile(
        dir,
        'read.js',
        "process.stdout.write(require('fs').readFileSync('marker.txt'))\n",
      ),
      cwd: dir,
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'passed')
    assert.match(result.output, /here/)
  })

  it('reports a command that cannot be found as failed rather than throwing', async () => {
    const result = await executeCheck({
      command: 'definitely-not-a-real-binary-xyz',
      cwd: workdir(),
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'failed')
    assert.notEqual(result.exitCode, 0)
  })

  it('times out a hanging command instead of waiting forever', async () => {
    const dir = workdir()
    const started = Date.now()
    const result = await executeCheck({
      command: nodeFile(dir, 'hang.js', 'setTimeout(() => {}, 60_000)\n'),
      cwd: dir,
      timeoutMs: 300,
    })
    assert.equal(result.outcome, 'timeout')
    assert.match(result.output, /timed out/)
    assert.ok(Date.now() - started < 20_000, 'timed-out check should settle promptly')
  })

  it('kills grandchildren, not just the shell', async () => {
    const dir = workdir()
    const leaked = join(dir, 'leaked.txt')
    const child = join(dir, 'child.js')
    writeFileSync(
      child,
      `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(leaked)}, 'leaked') }, 2000)\n`,
    )
    const result = await executeCheck({
      command: nodeFile(
        dir,
        'parent.js',
        `require('child_process').spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(child)}], { stdio: 'ignore', cwd: ${JSON.stringify(dir)} })
setTimeout(() => {}, 60_000)
`,
      ),
      cwd: dir,
      timeoutMs: 300,
    })
    assert.equal(result.outcome, 'timeout')
    await new Promise((r) => setTimeout(r, 2_500))
    assert.equal(existsSync(leaked), false)
  })

  it('stops early and reports skipped when aborted', async () => {
    const dir = workdir()
    const controller = new AbortController()
    const promise = executeCheck({
      command: nodeFile(dir, 'sleep.js', 'setTimeout(() => {}, 30_000)\n'),
      cwd: dir,
      timeoutMs: 30_000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)
    const result = await promise
    assert.equal(result.outcome, 'skipped')
    assert.match(result.output, /cancelled/)
  })

  it('does not resolve cancellation until the check child has closed', async () => {
    const dir = workdir()
    const controller = new AbortController()
    let settled = false
    const promise = executeCheck({
      command: nodeFile(
        dir,
        'slow-stop.js',
        `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 600))
setTimeout(() => {}, 30_000)
`,
      ),
      cwd: dir,
      timeoutMs: 30_000,
      signal: controller.signal,
    }).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal(settled, false)
    const result = await promise
    assert.equal(result.outcome, 'skipped')
  })

  it('keeps the tail of a very chatty command', async () => {
    const dir = workdir()
    const result = await executeCheck({
      command: nodeFile(
        dir,
        'chatty.js',
        'for (let i = 1; i <= 4000; i++) console.log("line-" + i + " padding padding padding padding")\n',
      ),
      cwd: dir,
      timeoutMs: 60_000,
    })
    assert.equal(result.outcome, 'passed')
    assert.ok(
      result.output.length <= CHECK_OUTPUT_TAIL_CHARS + 40,
      `expected bounded output, got ${result.output.length}`,
    )
    assert.match(result.output, /line-4000/)
    assert.doesNotMatch(result.output, /line-1 /)
  })

  it('measures how long the check took', async () => {
    const dir = workdir()
    const result = await executeCheck({
      command: nodeFile(dir, 'pause.js', 'setTimeout(() => {}, 200)\n'),
      cwd: dir,
      timeoutMs: 30_000,
    })
    assert.ok(result.durationMs >= 150, `expected a measured duration, got ${result.durationMs}`)
  })
})
