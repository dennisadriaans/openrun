import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  automationsEmptyKind,
  hasProjects,
  needProjectBeforeAutomationDetail,
  needProjectBeforeAutomationMessage,
} from './projectGate.ts'

describe('hasProjects', () => {
  it('is false when there are no projects', () => {
    assert.equal(hasProjects(0), false)
  })

  it('is true when at least one project exists', () => {
    assert.equal(hasProjects(1), true)
    assert.equal(hasProjects(3), true)
  })

  it('rejects non-positive and non-finite counts', () => {
    assert.equal(hasProjects(-1), false)
    assert.equal(hasProjects(Number.NaN), false)
    assert.equal(hasProjects(Number.POSITIVE_INFINITY), false)
  })
})

describe('automationsEmptyKind', () => {
  it('asks for a project before create/planner CTAs', () => {
    assert.equal(automationsEmptyKind(0), 'need-project')
  })

  it('offers create/planner once a project exists', () => {
    assert.equal(automationsEmptyKind(1), 'ready-to-create')
  })
})

describe('needProjectBeforeAutomationMessage', () => {
  it('is one line pointing at Projects', () => {
    assert.equal(
      needProjectBeforeAutomationMessage(),
      'Add a project (repository) before creating an automation.',
    )
  })
})

describe('needProjectBeforeAutomationDetail', () => {
  it('explains the workspace requirement', () => {
    assert.match(needProjectBeforeAutomationDetail(), /workspace/i)
  })
})
