import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('clear empties the shared command list and the saved history', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'openrun-history-'))
  const previous = process.env.OPENRUN_HOME
  process.env.OPENRUN_HOME = home
  t.after(() => {
    if (previous === undefined) delete process.env.OPENRUN_HOME
    else process.env.OPENRUN_HOME = previous
    rmSync(home, { recursive: true, force: true })
  })
  const { CommandHistory } = await import('./history.ts')
  const history = new CommandHistory()
  history.remember('create a.css')
  history.remember('runs')
  const shown = history.commands
  history.clear()
  assert.deepEqual(shown, [])
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'cli-history.json'), 'utf8')), [])
  assert.deepEqual(new CommandHistory().commands, [])
})
