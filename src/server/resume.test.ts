import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { RuntimeRow } from './db.ts'
import {
  buildTurnCommand,
  extractSessionId,
  parseAssistantText,
  runtimeKind,
  supportsResume,
} from './resume.ts'

function runtime(
  partial: Partial<RuntimeRow> & Pick<RuntimeRow, 'bin' | 'argsTemplate'>,
): RuntimeRow {
  return {
    id: 'rt',
    label: 'test',
    promptViaStdin: 1,
    description: '',
    enabled: 1,
    canOpenPrs: 0,
    transport: 'cli',
    createdAt: 0,
    ...partial,
  }
}

describe('runtimeKind', () => {
  it('maps fx binaries to the fx kind', () => {
    assert.equal(runtimeKind('fx'), 'fx')
    assert.equal(runtimeKind('/usr/local/bin/fx'), 'fx')
    assert.equal(runtimeKind('fx.exe'), 'fx')
  })
})

describe('supportsResume', () => {
  it('resumes fx over ACP and over fx ask', () => {
    assert.equal(supportsResume('fx', 'acp'), true)
    assert.equal(supportsResume('fx', 'cli'), true)
  })
})

describe('buildTurnCommand fx ACP', () => {
  it('launches fx acp and injects --model plus process env', () => {
    const turn = buildTurnCommand({
      runtime: runtime({
        bin: 'fx',
        argsTemplate: JSON.stringify(['acp']),
        transport: 'acp',
        promptViaStdin: 0,
      }),
      prompt: 'hello',
      cwd: '/tmp/app',
      sessionId: '',
      isFollowUp: false,
      model: 'zai/glm-5.2-fast',
      runtimeMode: 'full-access',
    })
    assert.deepEqual(turn.args, ['acp', '--model', 'zai/glm-5.2-fast'])
    assert.equal(turn.canResume, true)
    assert.equal(turn.acpPrompt, 'hello')
    assert.equal(turn.extraEnv?.FX_MODEL, 'zai/glm-5.2-fast')
    assert.equal(turn.extraEnv?.FX_PERMISSION_MODE, 'yolo')
  })

  it('loads the prior ACP session on follow-up', () => {
    const turn = buildTurnCommand({
      runtime: runtime({
        bin: 'fx',
        argsTemplate: JSON.stringify(['acp']),
        transport: 'acp',
        promptViaStdin: 0,
      }),
      prompt: 'continue',
      cwd: '/tmp/app',
      sessionId: '1770-1-abcd',
      isFollowUp: true,
    })
    assert.equal(turn.acpSessionId, '1770-1-abcd')
    assert.deepEqual(turn.args, ['acp'])
  })
})

describe('buildTurnCommand fx CLI', () => {
  it('forces ask --json and yolo on a first turn', () => {
    const turn = buildTurnCommand({
      runtime: runtime({
        bin: 'fx',
        argsTemplate: JSON.stringify(['ask']),
        promptViaStdin: 1,
      }),
      prompt: 'hello',
      cwd: '/tmp/app',
      sessionId: '',
      isFollowUp: false,
      runtimeMode: 'full-access',
    })
    assert.deepEqual(turn.args, ['ask', '--json', '--yolo'])
    assert.equal(turn.stdin, 'hello')
    assert.equal(turn.extraEnv?.FX_PERMISSION_MODE, 'yolo')
  })

  it('resumes with fx ask --resume', () => {
    const turn = buildTurnCommand({
      runtime: runtime({
        bin: 'fx',
        argsTemplate: JSON.stringify(['ask', '--json']),
        promptViaStdin: 1,
      }),
      prompt: 'now tests',
      cwd: '/tmp/app',
      sessionId: '1770-1-abcd',
      isFollowUp: true,
      runtimeMode: 'auto-accept-edits',
    })
    assert.deepEqual(turn.args, ['ask', '--json', '--resume', '1770-1-abcd', '--auto'])
    assert.equal(turn.stdin, 'now tests')
    assert.equal(turn.extraEnv?.FX_PERMISSION_MODE, 'auto')
  })
})

describe('extractSessionId', () => {
  it('reads a non-uuid fx session_id from a JSON object', () => {
    assert.equal(
      extractSessionId(
        '{"output":"hi","exit_code":0,"model":"zai/glm-5.2-fast","session_id":"1770-1-abcd","steps":1,"tool_calls":[]}\n',
      ),
      '1770-1-abcd',
    )
  })
})

describe('parseAssistantText', () => {
  it('unwraps fx ask --json output', () => {
    assert.equal(
      parseAssistantText(
        '{"output":"hello from fx","exit_code":0,"model":"zai/glm-5.2-fast","session_id":"s","steps":1,"tool_calls":[]}',
      ),
      'hello from fx',
    )
  })
})
