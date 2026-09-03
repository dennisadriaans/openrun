import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTurnCommand } from './resume.ts'
import type { RuntimeRow } from './db.ts'

const antigravityRuntime: RuntimeRow = {
  id: 'antigravity',
  label: 'Antigravity CLI',
  bin: 'agy',
  argsTemplate: JSON.stringify([
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
    '-p',
    '{prompt}',
  ]),
  promptViaStdin: 0,
  description: 'test',
  enabled: 1,
  canOpenPrs: 0,
  transport: 'cli',
  createdAt: 0,
}

function promptArgv(args: string[]): { flagAt: number; prompt: string } {
  const flagAt = args.indexOf('-p')
  assert.notEqual(flagAt, -1)
  const prompt = args[flagAt + 1]
  assert.equal(typeof prompt, 'string')
  return { flagAt, prompt: prompt! }
}

test('antigravity first turn passes prompt on argv, not stdin', () => {
  const turn = buildTurnCommand({
    runtime: antigravityRuntime,
    prompt: 'hello agy',
    cwd: '/tmp/repo',
    sessionId: '',
    isFollowUp: false,
  })

  assert.equal(turn.stdin, null)
  const { flagAt, prompt } = promptArgv(turn.args)
  assert.equal(prompt, 'hello agy')
  assert.ok(turn.args.indexOf('--output-format') < flagAt)
  assert.notEqual(turn.args[flagAt + 1], '--output-format')
})

test('antigravity follow-up keeps output-format before -p', () => {
  const turn = buildTurnCommand({
    runtime: antigravityRuntime,
    prompt: 'follow up',
    cwd: '/tmp/repo',
    sessionId: 'conv-123',
    isFollowUp: true,
  })

  assert.equal(turn.stdin, null)
  const { flagAt, prompt } = promptArgv(turn.args)
  assert.equal(prompt, 'follow up')
  assert.ok(turn.args.includes('--conversation'))
  assert.ok(turn.args.indexOf('--output-format') < flagAt)
})

test('antigravity never receives the Claude-only flags agy rejects', () => {
  for (const isFollowUp of [false, true]) {
    const turn = buildTurnCommand({
      runtime: antigravityRuntime,
      prompt: 'hi',
      cwd: '/tmp/repo',
      sessionId: isFollowUp ? 'conv-123' : '',
      isFollowUp,
      machineReadable: true,
    })
    assert.ok(!turn.args.includes('--verbose'), `--verbose leaked (isFollowUp=${isFollowUp})`)
    assert.ok(
      !turn.args.includes('--include-partial-messages'),
      `--include-partial-messages leaked (isFollowUp=${isFollowUp})`,
    )
    assert.ok(turn.args.includes('--output-format'))
  }
})
