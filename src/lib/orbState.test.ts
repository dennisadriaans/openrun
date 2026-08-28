import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ORB_STATES,
  isActivityOrbState,
  mergeThoughtText,
  orbStateForTool,
  orbVerb,
} from './orbState.ts'

describe('orbStateForTool', () => {
  it('covers every shipped orb via kind or role', () => {
    const used = new Set([
      orbStateForTool({ toolKind: 'execute' }),
      orbStateForTool({ toolKind: 'read' }),
      orbStateForTool({ toolKind: 'search' }),
      orbStateForTool({ toolKind: 'fetch' }),
      orbStateForTool({ toolKind: 'think' }),
      orbStateForTool({ toolKind: 'edit' }),
      orbStateForTool({ toolKind: 'delete' }),
      orbStateForTool({ toolKind: 'move' }),
      orbStateForTool({ toolKind: 'switch_mode' }),
      orbStateForTool({ callRole: 'mcp', toolKind: 'other' }),
      orbStateForTool({ callRole: 'subagent', toolKind: 'think' }),
      orbStateForTool({ callRole: 'skill', toolKind: 'think' }),
      orbStateForTool({ toolKind: 'other' }),
    ])
    assert.deepEqual(
      [...used].sort(),
      ['connecting', 'searching', 'shaping', 'solving', 'weaving', 'working'].sort(),
    )
  })

  it('lets call role win over an inferred think kind', () => {
    assert.equal(orbStateForTool({ callRole: 'subagent', toolKind: 'think' }), 'weaving')
    assert.equal(orbStateForTool({ callRole: 'mcp', toolKind: 'search' }), 'connecting')
    assert.equal(orbStateForTool({ callRole: 'skill', toolKind: 'think' }), 'working')
  })
})

describe('orbVerb', () => {
  it('names every shipped state', () => {
    for (const state of ORB_STATES) {
      assert.equal(typeof orbVerb(state), 'string')
      assert.ok(orbVerb(state).length > 0)
    }
    assert.equal(isActivityOrbState('solving'), true)
    assert.equal(isActivityOrbState('hovering'), false)
  })
})

describe('mergeThoughtText', () => {
  it('treats a longer prefix match as a snapshot, not a second thought', () => {
    assert.equal(mergeThoughtText('Hel', 'Hello'), 'Hello')
    assert.equal(mergeThoughtText('', 'Hello'), 'Hello')
    assert.equal(mergeThoughtText('Hello', ''), 'Hello')
    assert.equal(mergeThoughtText('Hello', 'Hel'), 'Hello')
  })

  it('joins distinct blocks with a blank line', () => {
    assert.equal(mergeThoughtText('first', 'second'), 'first\n\nsecond')
  })
})
