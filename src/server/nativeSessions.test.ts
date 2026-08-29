import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { encodeClaudeProjectDir } from '../lib/nativeSessions.ts'
import { importNativeTranscript } from './nativeImport.ts'
import { readNativeTranscript } from './nativeTranscript.ts'
import { claudeSessionFile, nativeSessionExists, safeNativeSessionFile } from './nativeSessions.ts'

const home = mkdtempSync(join(tmpdir(), 'openrun-native-home-'))
const workspace = mkdtempSync(join(home, 'workspace-'))
const previousHome = process.env.HOME
const previousOpenrunHome = process.env.OPENRUN_HOME
process.env.HOME = home
process.env.OPENRUN_HOME = join(home, '.openrun')

const claudeDir = join(home, '.claude', 'projects', encodeClaudeProjectDir(workspace))
const outsideDir = join(home, '.claude', 'projects', `${basename(claudeDir)}-evil`)
const validId = '11111111-1111-4111-8111-111111111111'

before(() => {
  mkdirSync(claudeDir, { recursive: true })
  mkdirSync(outsideDir, { recursive: true })
})

after(() => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousOpenrunHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousOpenrunHome
  rmSync(home, { recursive: true, force: true })
})

function transcript(): string {
  return [
    JSON.stringify({
      type: 'user',
      timestamp: '2026-08-29T10:00:00.000Z',
      message: { content: 'Read this transcript' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-29T10:00:01.000Z',
      message: { content: [{ type: 'text', text: 'Imported.' }] },
    }),
  ].join('\n')
}

describe('Claude native session path safety', () => {
  it('locates a valid basename and reads its transcript', () => {
    const file = safeNativeSessionFile(claudeDir, validId, '.jsonl')
    assert.equal(file, claudeSessionFile(workspace, validId))
    writeFileSync(file, transcript())

    assert.equal(nativeSessionExists(workspace, 'claude', validId), true)
    assert.equal(
      readNativeTranscript(workspace, 'claude', validId)[0]?.prompt,
      'Read this transcript',
    )
  })

  it('rejects path-like, control, and empty ids at read/import boundaries', () => {
    const invalidIds = [
      '',
      '../outside',
      '/absolute/path',
      'nested/session',
      'nested\\session',
      '.',
      '..',
      'has\u0000nul',
      'has\u001fcontrol',
    ]

    for (const id of invalidIds) {
      assert.equal(nativeSessionExists(workspace, 'claude', id), false, id)
      assert.throws(() => claudeSessionFile(workspace, id), /Invalid native session id/)
      assert.throws(
        () => readNativeTranscript(workspace, 'claude', id),
        /Invalid native session id/,
      )
      assert.throws(
        () =>
          importNativeTranscript({
            runId: 'run-invalid',
            cwd: workspace,
            kind: 'claude',
            sessionId: id,
            label: '',
            before: 10_000,
          }),
        /Invalid native session id/,
      )
    }
  })

  it('returns absent for a missing valid id without touching another path', () => {
    const missing = '22222222-2222-4222-8222-222222222222'
    assert.equal(nativeSessionExists(workspace, 'claude', missing), false)
    assert.deepEqual(readNativeTranscript(workspace, 'claude', missing), [])
    assert.equal(existsSync(join(outsideDir, `${missing}.jsonl`)), false)
  })

  it('refuses a transcript symlink, including one targeting a sibling prefix', () => {
    const outside = join(outsideDir, 'outside.jsonl')
    const linkedId = '33333333-3333-4333-8333-333333333333'
    writeFileSync(outside, transcript())
    symlinkSync(outside, join(claudeDir, `${linkedId}.jsonl`))

    assert.equal(nativeSessionExists(workspace, 'claude', linkedId), false)
    assert.throws(
      () => readNativeTranscript(workspace, 'claude', linkedId),
      /not a regular file inside the expected session directory/,
    )
    assert.throws(
      () =>
        importNativeTranscript({
          runId: 'run-symlink',
          cwd: workspace,
          kind: 'claude',
          sessionId: linkedId,
          label: '',
          before: 10_000,
        }),
      /not a regular file inside the expected session directory/,
    )
  })
})
