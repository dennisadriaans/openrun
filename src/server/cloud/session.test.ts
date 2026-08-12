import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('machine id is stable across reads', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentops-cloud-'))
  const prev = process.env.AGENTOPS_HOME
  process.env.AGENTOPS_HOME = home
  try {
    const { readMachineId, readCloudSession, writeCloudSession, clearCloudSession } =
      await import('./session.ts')
    const a = readMachineId()
    const b = readMachineId()
    assert.equal(a, b)
    assert.match(a, /^mch_/)
    assert.equal(readCloudSession(), null)
    writeCloudSession({
      accessToken: 'a',
      refreshToken: 'r',
      userId: 'usr_1',
      email: 'a@b.c',
      machineId: a,
    })
    const session = readCloudSession()
    assert.equal(session?.email, 'a@b.c')
    clearCloudSession()
    assert.equal(readCloudSession(), null)
  } finally {
    if (prev === undefined) delete process.env.AGENTOPS_HOME
    else process.env.AGENTOPS_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})
