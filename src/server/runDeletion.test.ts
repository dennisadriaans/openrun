import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { describe, it } from 'node:test'
import {
  deleteRunsInTransaction,
  MAX_RUN_DELETE_COUNT,
  normalizeRunDeleteIds,
} from './runDeletion.ts'

function database() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE check_results (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE message_queue (
      id TEXT PRIMARY KEY,
      runId TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE turn_events (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE
    );
  `)
  return db
}

function addRun(db: Database.Database, id: string, status = 'success') {
  db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(id, status)
}

function countRows(db: Database.Database, table: string) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  return row.n
}

describe('run deletion', () => {
  it('validates non-empty bounded ids and deduplicates them', () => {
    assert.deepEqual(normalizeRunDeleteIds(['a', 'a', 'b']), ['a', 'b'])
    assert.throws(() => normalizeRunDeleteIds([]), /At least one run ID/)
    assert.throws(
      () =>
        normalizeRunDeleteIds(Array.from({ length: MAX_RUN_DELETE_COUNT + 1 }, (_, i) => `r${i}`)),
      /more than 100/,
    )
    assert.throws(() => normalizeRunDeleteIds(['']), /non-empty strings/)
    assert.throws(() => normalizeRunDeleteIds(null), /must be an array/)
  })

  it('deletes duplicate terminal ids once', () => {
    const db = database()
    addRun(db, 'done')

    deleteRunsInTransaction(db, ['done', 'done'])

    assert.equal(countRows(db, 'runs'), 0)
    db.close()
  })

  it('rejects a missing id without deleting any other id', () => {
    const db = database()
    addRun(db, 'keep')

    assert.throws(() => deleteRunsInTransaction(db, ['keep', 'missing']), /Run not found/)
    assert.equal(countRows(db, 'runs'), 1)
    db.close()
  })

  it('rejects a running id without deleting any terminal id', () => {
    const db = database()
    addRun(db, 'done')
    addRun(db, 'live', 'running')

    assert.throws(
      () => deleteRunsInTransaction(db, ['done', 'live']),
      /Cancel the run before deleting it/,
    )
    assert.equal(countRows(db, 'runs'), 2)
    db.close()
  })

  it('cascades child conversation, check, queue, and event rows', () => {
    const db = database()
    addRun(db, 'done')
    db.prepare('INSERT INTO messages (id, runId) VALUES (?, ?)').run('message', 'done')
    db.prepare('INSERT INTO check_results (id, runId) VALUES (?, ?)').run('check', 'done')
    db.prepare('INSERT INTO message_queue (id, runId) VALUES (?, ?)').run('queued', 'done')
    db.prepare('INSERT INTO turn_events (id, messageId) VALUES (?, ?)').run('event', 'message')

    deleteRunsInTransaction(db, ['done'])

    for (const table of ['runs', 'messages', 'check_results', 'message_queue', 'turn_events']) {
      assert.equal(countRows(db, table), 0, table)
    }
    db.close()
  })
})
