import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { CHECK_OUTPUT_TAIL_CHARS } from '../lib/checks.ts'
import { executeCheck } from './checks.ts'

const dirs: string[] = []

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
    const result = await executeCheck({
      command: 'echo all-green',
      cwd: workdir(),
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'passed')
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /all-green/)
  })

  it('fails on a non-zero exit and keeps the exit code', async () => {
    const result = await executeCheck({
      command: 'echo boom >&2; exit 3',
      cwd: workdir(),
      timeoutMs: 30_000,
    })
    assert.equal(result.outcome, 'failed')
    assert.equal(result.exitCode, 3)
    assert.match(result.output, /boom/)
  })

  it('captures stderr as well as stdout', async () => {
    const result = await executeCheck({
      command: 'echo to-out; echo to-err >&2; exit 1',
      cwd: workdir(),
      timeoutMs: 30_000,
    })
    assert.match(result.output, /to-out/)
    assert.match(result.output, /to-err/)
  })

  it('runs in the given working directory', async () => {
    const dir = workdir()
    writeFileSync(join(dir, 'marker.txt'), 'here')
    const result = await executeCheck({ command: 'cat marker.txt', cwd: dir, timeoutMs: 30_000 })
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
    const started = Date.now()
    const result = await executeCheck({
      command: 'sleep 60',
      cwd: workdir(),
      timeoutMs: 300,
    })
    assert.equal(result.outcome, 'timeout')
    assert.match(result.output, /timed out/)
    // Well under the 60s the command asked for — the kill actually landed.
    assert.ok(Date.now() - started < 20_000, 'timed-out check should settle promptly')
  })

  it('kills grandchildren, not just the shell', async () => {
    const dir = workdir()
    // The shell backgrounds a child that would outlive a naive child.kill().
    // If the process group is killed, the marker file is never written.
    const script = join(dir, 'spawn.sh')
    writeFileSync(script, `sleep 2 && echo leaked > ${join(dir, 'leaked.txt')}\n`)
    const result = await executeCheck({
      command: `sh ${script}`,
      cwd: dir,
      timeoutMs: 300,
    })
    assert.equal(result.outcome, 'timeout')
    await new Promise((r) => setTimeout(r, 2_500))
    const listing = await executeCheck({
      command: 'ls',
      cwd: dir,
      timeoutMs: 10_000,
    })
    assert.doesNotMatch(listing.output, /leaked\.txt/)
  })

  it('stops early and reports skipped when aborted', async () => {
    const controller = new AbortController()
    const promise = executeCheck({
      command: 'sleep 30',
      cwd: workdir(),
      timeoutMs: 30_000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 100)
    const result = await promise
    assert.equal(result.outcome, 'skipped')
    assert.match(result.output, /cancelled/)
  })

  it('keeps the tail of a very chatty command', async () => {
    const result = await executeCheck({
      // ~200k of output — far past the retained tail.
      command: 'for i in $(seq 1 4000); do echo "line-$i padding padding padding padding"; done',
      cwd: workdir(),
      timeoutMs: 60_000,
    })
    assert.equal(result.outcome, 'passed')
    assert.ok(
      result.output.length <= CHECK_OUTPUT_TAIL_CHARS + 40,
      `expected bounded output, got ${result.output.length}`,
    )
    // The end of the stream is what a compiler / test runner puts the summary in.
    assert.match(result.output, /line-4000/)
    assert.doesNotMatch(result.output, /line-1 /)
  })

  it('measures how long the check took', async () => {
    const result = await executeCheck({
      command: 'sleep 0.2',
      cwd: workdir(),
      timeoutMs: 30_000,
    })
    assert.ok(result.durationMs >= 150, `expected a measured duration, got ${result.durationMs}`)
  })
})
