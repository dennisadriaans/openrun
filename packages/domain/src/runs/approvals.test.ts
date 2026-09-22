import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALLOW_ONCE,
  REJECT_ONCE,
  decisionForOption,
  permissionOptionsForTool,
  permissionOutcome,
  resolveApprovalAnswer,
} from './approvals.ts'

describe('permissionOptionsForTool', () => {
  it('offers only once-scoped options, since JSONL CLIs cannot remember a choice', () => {
    const options = permissionOptionsForTool('Bash')
    assert.deepEqual(
      options.map((o) => o.kind),
      ['allow_once', 'reject_once'],
    )
    assert.equal(options[0]?.name, 'Allow Bash')
  })

  it('drops the tool name when there is none', () => {
    assert.equal(permissionOptionsForTool()[0]?.name, 'Allow')
  })
})

describe('decisionForOption', () => {
  it('reads the decision off the option kind', () => {
    assert.equal(
      decisionForOption({ optionId: 'x', name: 'Always', kind: 'allow_always' }, 'x'),
      'allow',
    )
    assert.equal(
      decisionForOption({ optionId: 'x', name: 'Never', kind: 'reject_always' }, 'x'),
      'deny',
    )
  })

  it('falls back to our own option ids for unknown options', () => {
    assert.equal(decisionForOption(undefined, ALLOW_ONCE), 'allow')
    assert.equal(decisionForOption(undefined, 'something-else'), 'deny')
  })
})

describe('resolveApprovalAnswer', () => {
  const options = permissionOptionsForTool('Bash')

  it('resolves an explicit optionId against the offered list', () => {
    assert.deepEqual(resolveApprovalAnswer({ options, optionId: ALLOW_ONCE }), {
      optionId: ALLOW_ONCE,
      decision: 'allow',
    })
    assert.deepEqual(resolveApprovalAnswer({ options, optionId: REJECT_ONCE }), {
      optionId: REJECT_ONCE,
      decision: 'deny',
    })
  })

  it('maps a bare allow/deny onto a matching option', () => {
    assert.deepEqual(resolveApprovalAnswer({ options, decision: 'allow' }), {
      optionId: ALLOW_ONCE,
      decision: 'allow',
    })
  })

  it('prefers the once-scoped option so "allow" never grants standing permission', () => {
    const withAlways = [
      { optionId: 'always', name: 'Always allow', kind: 'allow_always' as const },
      { optionId: 'once', name: 'Allow once', kind: 'allow_once' as const },
    ]
    assert.equal(resolveApprovalAnswer({ options: withAlways, decision: 'allow' }).optionId, 'once')
  })

  it('denies when nothing was supplied at all', () => {
    assert.deepEqual(resolveApprovalAnswer({}), { optionId: REJECT_ONCE, decision: 'deny' })
  })

  it('still answers when the agent offered options we do not recognise', () => {
    const agentOptions = [{ optionId: 'proceed', name: 'Proceed', kind: 'allow_once' as const }]
    assert.deepEqual(resolveApprovalAnswer({ options: agentOptions, optionId: 'proceed' }), {
      optionId: 'proceed',
      decision: 'allow',
    })
  })
})

describe('permissionOutcome', () => {
  it('builds the ACP selected-outcome body', () => {
    assert.deepEqual(permissionOutcome('allow-once'), {
      outcome: 'selected',
      optionId: 'allow-once',
    })
  })
})
