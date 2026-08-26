import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMainCheckout, pickDefaultWorkspace, pickDefaultWorkspaceId } from './pickWorkspace.ts'

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

  it('prefers a ready worktree over the main checkout', () => {
    assert.equal(pickDefaultWorkspace([mainReady, creating, featureReady])?.id, 'ws-feat')
  })

  it('falls back to main when no worktree is ready', () => {
    assert.equal(pickDefaultWorkspace([mainReady, creating, errored])?.id, 'ws-main')
  })

  it('honours an explicit main preference', () => {
    assert.equal(
      pickDefaultWorkspace([featureReady, mainReady], { prefer: 'main' })?.id,
      'ws-main',
    )
  })

  it('falls back to a worktree when main is preferred but not ready', () => {
    assert.equal(
      pickDefaultWorkspace([mainCreating, featureReady], { prefer: 'main' })?.id,
      'ws-feat',
    )
  })

  it('picks the sole ready workspace', () => {
    assert.equal(pickDefaultWorkspace([creating, mainReady, errored])?.id, 'ws-main')
  })

  it('ignores archived and error rows even when kind is main', () => {
    assert.equal(
      pickDefaultWorkspace([{ id: 'bad-main', status: 'error', kind: 'main' }, featureReady])?.id,
      'ws-feat',
    )
  })
})

describe('pickDefaultWorkspaceId', () => {
  it('returns only the id', () => {
    assert.equal(pickDefaultWorkspaceId([featureReady, mainReady]), 'ws-feat')
    assert.equal(pickDefaultWorkspaceId([mainReady]), 'ws-main')
    assert.equal(pickDefaultWorkspaceId([creating]), undefined)
    assert.equal(pickDefaultWorkspaceId([]), undefined)
  })
})

describe('isMainCheckout', () => {
  it('is true only for a main row', () => {
    assert.equal(isMainCheckout(mainReady), true)
    assert.equal(isMainCheckout(featureReady), false)
    assert.equal(isMainCheckout(undefined), false)
  })
})
