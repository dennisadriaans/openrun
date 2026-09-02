import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { runCommand } from './command.ts'

const node = JSON.stringify(process.execPath)

describe('runCommand', () => {
  it('returns stdout, stderr and the exit code of a command that finishes', async () => {
    const res = await runCommand({
      command: process.execPath,
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      timeoutMs: 10_000,
    })
    assert.equal(res.status, 0)
    assert.equal(res.stdout, 'out')
    assert.equal(res.stderr, 'err')
    assert.equal(res.timedOut, false)
  })

  it('reports a non-zero exit rather than throwing', async () => {
    const res = await runCommand({
      command: process.execPath,
      args: ['-e', 'process.exit(3)'],
      timeoutMs: 10_000,
    })
    assert.equal(res.status, 3)
    assert.equal(res.timedOut, false)
  })

  it('kills a command that outruns its budget instead of hanging forever', async () => {
    const started = Date.now()
    const res = await runCommand({
      command: process.execPath,
      // Never exits on its own — the old `spawnSync` path would have blocked
      // the whole server on exactly this.
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 300,
    })
    assert.equal(res.timedOut, true)
    assert.ok(Date.now() - started < 10_000, 'should not wait anywhere near a real budget')
  })

  it('does not block the event loop while it waits', async () => {
    let ticked = false
    const timer = setTimeout(() => {
      ticked = true
    }, 50)
    await runCommand({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 400)'],
      timeoutMs: 10_000,
    })
    clearTimeout(timer)
    // Under `spawnSync` the loop is frozen, so this timer could not have run.
    assert.equal(ticked, true)
  })

  it('runs a shell command line when asked', async () => {
    const res = await runCommand({
      command: `${node} -e "process.stdout.write('shell')"`,
      shell: true,
      timeoutMs: 10_000,
    })
    assert.equal(res.status, 0)
    assert.equal(res.stdout, 'shell')
  })

  it('reports a missing binary as a failed result, not a rejection', async () => {
    const res = await runCommand({
      command: 'openrun-definitely-not-a-real-binary',
      timeoutMs: 10_000,
    })
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /ENOENT|not found/i)
  })

  it('takes grandchildren down with it on a timeout', async (t) => {
    if (process.platform === 'win32') return t.skip('process groups are POSIX-only here')
    // A shell that spawns a long-lived grandchild and prints its pid: killing
    // only the shell would leave the grandchild writing to the worktree.
    const res = await runCommand({
      command: `${node} -e "setInterval(()=>{},1000)" & echo $!; wait`,
      shell: true,
      timeoutMs: 400,
    })
    assert.equal(res.timedOut, true)

    const pid = Number(res.stdout.trim().split('\n')[0])
    assert.ok(Number.isFinite(pid) && pid > 0, `expected a grandchild pid, got ${res.stdout}`)

    // killChildTree escalates to SIGKILL after its grace period.
    const deadline = Date.now() + 8_000
    let alive = true
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0)
      } catch {
        alive = false
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (alive) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Best effort: do not leak a process if the assertion is about to fail.
      }
    }
    assert.equal(alive, false, 'the grandchild should have been killed with the group')
  })
})
