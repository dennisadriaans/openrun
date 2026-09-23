import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('sealString round-trips and keeps plaintext out of the blob', async () => {
  const home = mkdtempSync(join(tmpdir(), 'openrun-seal-'))
  const prev = process.env.OPENRUN_HOME
  process.env.OPENRUN_HOME = home
  try {
    const { isSealed, revealString, sealString, secretAad, dataKeyPath } = await import(
      './secretBox.ts'
    )
    const aad = secretAad('mcp.accessToken', 'linear')
    const sealed = sealString('lin_live_secret', aad)
    assert.equal(isSealed(sealed), true)
    assert.equal(sealed.includes('lin_live_secret'), false)
    assert.equal(revealString(sealed, aad), 'lin_live_secret')
    assert.equal(sealString('', aad), '')
    assert.equal(revealString('legacy-plain', aad), 'legacy-plain')
    const key = readFileSync(dataKeyPath(), 'utf8').trim()
    assert.match(key, /^[0-9a-f]{64}$/i)
    assert.throws(() => revealString(sealed, secretAad('mcp.accessToken', 'other')))
  } finally {
    if (prev === undefined) delete process.env.OPENRUN_HOME
    else process.env.OPENRUN_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})
