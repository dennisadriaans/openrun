import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeClaudeProjectDir } from '../lib/nativeSessions.ts'
import { closeDb, getDb } from './db.ts'
import { allocateImportTimestamps, importNativeTranscript } from './nativeImport.ts'
import { claudeSessionFile } from './nativeSessions.ts'

const root = mkdtempSync(join(tmpdir(), 'openrun-native-import-'))
const home = join(root, 'home')
const workspace = join(root, 'workspace')
const cwdBefore = process.cwd()
const previousHome = process.env.HOME
const previousOpenrunHome = process.env.OPENRUN_HOME

before(() => {
  mkdirSync(home, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  process.env.HOME = home
  process.env.OPENRUN_HOME = join(home, '.openrun')
  process.chdir(root)
})

after(() => {
  closeDb()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousOpenrunHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousOpenrunHome
  rmSync(root, { recursive: true, force: true })
})

describe('allocateImportTimestamps', () => {
  it('is deterministic, strictly increasing, and clamps future/duplicate times', () => {
    const rows = [
      { sourceAt: 100 },
      { sourceAt: 100 },
      { sourceAt: 5_000 },
      {},
      { sourceAt: Number.NaN },
    ]
    const first = allocateImportTimestamps(rows, 1_000)
    const second = allocateImportTimestamps(rows, 1_000)

    assert.deepEqual(first, second)
    assert.equal(first.length, rows.length)
    assert.ok(first.every((value) => value < 1_000))
    assert.ok(first.every((value, index) => index === 0 || value > first[index - 1]!))
  })

  it('preserves valid source order while placing missing values between turns', () => {
    const timestamps = allocateImportTimestamps(
      [{}, { sourceAt: 200 }, {}, { sourceAt: 400 }],
      1_000,
    )
    assert.deepEqual(timestamps, [199, 200, 201, 400])
  })
})

describe('importNativeTranscript', () => {
  it('writes unique timestamps for imported messages and events before the boundary', () => {
    const sessionId = '44444444-4444-4444-8444-444444444444'
    const runId = 'run-native-import'
    const file = claudeSessionFile(workspace, sessionId)
    mkdirSync(join(home, '.claude', 'projects', encodeClaudeProjectDir(workspace)), {
      recursive: true,
    })
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: 'user',
          timestamp: '2099-08-29T10:00:00.000Z',
          message: { content: 'Future prompt' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2099-08-29T10:00:01.000Z',
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } },
              { type: 'text', text: 'Answer' },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2099-08-29T10:00:02.000Z',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
        }),
        JSON.stringify({
          type: 'user',
          timestamp: '2099-08-29T10:00:02.000Z',
          message: { content: 'Duplicate timestamp prompt' },
        }),
      ].join('\n'),
    )

    getDb()
      .prepare(
        `INSERT INTO runs (id, taskId, taskName, runtimeId, trigger, status, command, cwd, startedAt)
         VALUES (?, NULL, 'native import', 'claude', 'chat', 'success', '', ?, 100)`,
      )
      .run(runId, workspace)

    const result = importNativeTranscript({
      runId,
      cwd: workspace,
      kind: 'claude',
      sessionId,
      label: 'Imported future timestamps',
      before: 1_000,
    })
    assert.equal(result.turns, 2)
    assert.ok(result.startedAt < 1_000)

    const messages = getDb()
      .prepare('SELECT id, createdAt FROM messages WHERE runId = ? ORDER BY createdAt ASC')
      .all(runId) as Array<{ id: string; createdAt: number }>
    const events = getDb()
      .prepare(
        'SELECT messageId, seq, createdAt FROM turn_events WHERE runId = ? ORDER BY createdAt ASC, seq ASC',
      )
      .all(runId) as Array<{ messageId: string; seq: number; createdAt: number }>

    assert.ok(messages.length > 0)
    assert.ok(messages.every((row) => row.createdAt < 1_000))
    assert.equal(new Set(messages.map((row) => row.createdAt)).size, messages.length)
    assert.ok(events.length > 0)
    assert.ok(events.every((row) => row.createdAt < 1_000))
    assert.equal(new Set(events.map((row) => row.createdAt)).size, events.length)
    for (const messageId of new Set(events.map((row) => row.messageId))) {
      const seqs = events.filter((row) => row.messageId === messageId).map((row) => row.seq)
      assert.equal(new Set(seqs).size, seqs.length)
    }
  })
})
