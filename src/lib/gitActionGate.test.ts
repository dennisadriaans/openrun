import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canCommit,
  canCreatePullRequest,
  canDiscard,
  canPush,
  commitBlockedReason,
  discardBlockedReason,
  ghNotAuthenticatedMessage,
  ghNotInstalledMessage,
  missingOriginRemoteMessage,
  prBlockedReason,
  pushBlockedReason,
  workingTreeCleanMessage,
} from './gitActionGate.ts'

const healthyPr = {
  hasRemote: true,
  ghInstalled: true,
  ghAuthenticated: true,
}

describe('commitBlockedReason', () => {
  it('returns null when the working tree has changes', () => {
    assert.equal(commitBlockedReason({ hasChanges: true }), null)
    assert.equal(canCommit({ hasChanges: true }), true)
  })

  it('flags a clean working tree', () => {
    assert.equal(commitBlockedReason({ hasChanges: false }), workingTreeCleanMessage())
    assert.equal(canCommit({ hasChanges: false }), false)
  })
})

describe('discardBlockedReason', () => {
  it('returns null when the working tree has changes', () => {
    assert.equal(discardBlockedReason({ hasChanges: true }), null)
    assert.equal(canDiscard({ hasChanges: true }), true)
  })

  it('flags a clean working tree with the same copy as Commit', () => {
    assert.equal(discardBlockedReason({ hasChanges: false }), workingTreeCleanMessage())
    assert.equal(canDiscard({ hasChanges: false }), false)
    assert.equal(discardBlockedReason({ hasChanges: false }), commitBlockedReason({ hasChanges: false }))
  })
})

describe('pushBlockedReason', () => {
  it('returns null when origin is configured', () => {
    assert.equal(pushBlockedReason({ hasRemote: true }), null)
    assert.equal(canPush({ hasRemote: true }), true)
  })

  it('flags a missing origin remote', () => {
    assert.equal(pushBlockedReason({ hasRemote: false }), missingOriginRemoteMessage())
    assert.equal(canPush({ hasRemote: false }), false)
  })
})

describe('prBlockedReason', () => {
  it('returns null when remote and gh are ready', () => {
    assert.equal(prBlockedReason(healthyPr), null)
    assert.equal(canCreatePullRequest(healthyPr), true)
  })

  it('flags a missing origin before gh install / auth', () => {
    const reason = prBlockedReason({
      hasRemote: false,
      ghInstalled: false,
      ghAuthenticated: false,
    })
    assert.equal(reason, missingOriginRemoteMessage())
    assert.equal(canCreatePullRequest({ ...healthyPr, hasRemote: false }), false)
  })

  it('flags a missing gh CLI before auth', () => {
    assert.equal(
      prBlockedReason({
        hasRemote: true,
        ghInstalled: false,
        ghAuthenticated: false,
      }),
      ghNotInstalledMessage(),
    )
  })

  it('flags an unauthenticated gh last', () => {
    assert.equal(
      prBlockedReason({
        hasRemote: true,
        ghInstalled: true,
        ghAuthenticated: false,
      }),
      ghNotAuthenticatedMessage(),
    )
  })

  it('does not treat installed-but-unauthenticated as installed-ok for canCreate', () => {
    assert.equal(
      canCreatePullRequest({
        hasRemote: true,
        ghInstalled: true,
        ghAuthenticated: false,
      }),
      false,
    )
  })
})
