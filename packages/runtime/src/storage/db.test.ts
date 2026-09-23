/**
 * Boot the schema the way a new install does: an empty directory, nothing to
 * migrate from. `getDb()` resolves the file from `OPENRUN_HOME`.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'openrun-db-'))
const home = join(root, '.openrun')
const cwdBefore = process.cwd()
const previousHome = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = home
process.chdir(root)

const { getDb, closeDb, openrunDbPath, openrunHome } = await import('./db.ts')

after(() => {
  closeDb()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
})

function columns(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
}

describe('a brand-new database', () => {
  it('boots without a migration reaching a table that does not exist yet', () => {
    assert.doesNotThrow(() => getDb())
    assert.ok(existsSync(openrunDbPath()))
  })

  it('gives a fresh install the same columns an upgraded one has', () => {
    // These arrive as ALTER TABLE for existing users, so a fresh database that
    // skipped them would fail on the first insert instead of at boot.
    for (const column of ['sourceProvider', 'sourceUrl', 'sourceLabel']) {
      assert.ok(columns('run_queue').includes(column), `run_queue.${column}`)
      assert.ok(columns('messages').includes(column), `messages.${column}`)
    }
    assert.ok(columns('runs').includes('workspaceId'))
    assert.ok(columns('runs').includes('verdict'))
    assert.ok(columns('tasks').includes('scheduledAt'))
    assert.ok(columns('run_queue').includes('scheduleFireId'))
    assert.ok(columns('schedule_fires').includes('scheduledFor'))
    assert.ok(columns('workspaces').includes('baseCommit'))
  })

  it('accepts the insert the queue actually makes', () => {
    assert.doesNotThrow(() =>
      getDb()
        .prepare(
          `INSERT INTO run_queue (id, taskId, workspaceId, trigger, prompt,
                                  sourceProvider, sourceUrl, sourceLabel, scheduleFireId, queuedAt)
           VALUES ('q1', 't1', 'w1', 'webhook', 'go', 'github', 'https://x/1', 'PR #1', '', 1)`,
        )
        .run(),
    )
  })

  it('honours OPENRUN_HOME for app-managed state', () => {
    const previous = process.env.OPENRUN_HOME
    process.env.OPENRUN_HOME = join(root, 'custom-home')
    try {
      assert.equal(openrunHome(), join(root, 'custom-home'))
      assert.equal(openrunDbPath(), join(root, 'custom-home', 'openrun.db'))
    } finally {
      if (previous === undefined) delete process.env.OPENRUN_HOME
      else process.env.OPENRUN_HOME = previous
    }
  })

  it('moves a leftover checkout database into OPENRUN_HOME', () => {
    getDb()
    closeDb()
    const homeDb = openrunDbPath()
    const leftover = join(root, 'data', 'openrun.db')
    mkdirSync(join(root, 'data'), { recursive: true })
    renameSync(homeDb, leftover)
    for (const suffix of ['-wal', '-shm'] as const) {
      if (existsSync(homeDb + suffix)) renameSync(homeDb + suffix, leftover + suffix)
    }

    getDb()
    assert.ok(existsSync(homeDb))
    assert.equal(existsSync(leftover), false)
  })
})
