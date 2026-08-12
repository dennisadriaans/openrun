import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickDefaultWorkspace, pickDefaultWorkspaceId } from './pickWorkspace.ts'

const mainReady = { id: 'ws-main', status: 'ready', kind: 'main' }
const featureReady = { id: 'ws-feat', status: 'ready', kind: 'worktree' }
const creating = { id: 'ws-creating', status: 'creating', kind: 'worktree' }
const errored = { id: 'ws-error', status: 'error', kind: 'worktree' }
const archived = { id: 'ws-arch', status: 'archived', kind: 'worktree' }
const mainCreating = { id: 'ws-main-creating', status: 'creating', kind: 'main' }

describe('pickDefaultWorkspace', () => {
  it('returns undefined for an empty list', () => {
    assert.equal(pickDefaultWorkspace([]), undefined)
  })

  it('returns undefined when nothing is ready yet', () => {
    assert.equal(pickDefaultWorkspace([creating, errored, archived]), undefined)
    assert.equal(pickDefaultWorkspace([mainCreating]), undefined)
  })

  it('prefers a ready main checkout over other ready worktrees', () => {
    assert.equal(
      pickDefaultWorkspace([featureReady, creating, mainReady])?.id,
      'ws-main',
    )
  })

  it('falls back to the first ready worktree when main is not ready', () => {
    assert.equal(
      pickDefaultWorkspace([mainCreating, featureReady, creating])?.id,
      'ws-feat',
    )
  })

  it('picks the sole ready workspace', () => {
    assert.equal(pickDefaultWorkspace([creating, mainReady, errored])?.id, 'ws-main')
  })

  it('ignores archived and error rows even when kind is main', () => {
    assert.equal(
      pickDefaultWorkspace([
        { id: 'bad-main', status: 'error', kind: 'main' },
        featureReady,
      ])?.id,
      'ws-feat',
    )
  })
})

describe('pickDefaultWorkspaceId', () => {
  it('returns only the id', () => {
    assert.equal(pickDefaultWorkspaceId([featureReady, mainReady]), 'ws-main')
    assert.equal(pickDefaultWorkspaceId([creating]), undefined)
    assert.equal(pickDefaultWorkspaceId([]), undefined)
  })
})
