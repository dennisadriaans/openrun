import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('machine id is stable across reads', async () => {
  const home = mkdtempSync(join(tmpdir(), 'agentops-cloud-'))
  const prev = process.env.OPENRUN_HOME
  process.env.OPENRUN_HOME = home
  try {
    const { readMachineId, readCloudSession, writeCloudSession, clearCloudSession } = await import(
      './session.ts'
    )
    const a = readMachineId()
    const b = readMachineId()
    assert.equal(a, b)
    assert.match(a, /^mch_/)
    assert.equal(readCloudSession(), null)
    writeCloudSession({
      accessToken: 'a',
      refreshToken: 'r',
      accessExpiresAt: 1_700_000_000_000,
      userId: 'usr_1',
      email: 'a@b.c',
      machineId: a,
    })
    const session = readCloudSession()
    assert.equal(session?.email, 'a@b.c')
    assert.equal(session?.accessExpiresAt, 1_700_000_000_000)
    clearCloudSession()
    assert.equal(readCloudSession(), null)
  } finally {
    if (prev === undefined) delete process.env.OPENRUN_HOME
    else process.env.OPENRUN_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})
