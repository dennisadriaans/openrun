import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MOBILE_SCOPE,
  MOBILE_OPS,
  type MobileOp,
  isMobileScope,
  mobileScopeAllows,
  mobileScopeSummary,
} from './mobileScope.ts'

test('the control scope grants every declared op', () => {
  for (const op of MOBILE_OPS) {
    assert.equal(mobileScopeAllows('control', op), true, `expected ${op} allowed`)
  }
})

test('an unknown scope tag denies everything', () => {
  for (const op of MOBILE_OPS) {
    assert.equal(mobileScopeAllows('admin', op), false)
    assert.equal(mobileScopeAllows('', op), false)
  }
})

test('a downgraded build does not honour a scope it does not know', () => {
  // A device paired by a newer build carries a tag this build has never seen.
  assert.equal(isMobileScope('control-v2'), false)
  assert.equal(mobileScopeAllows('control-v2', 'runs.read'), false)
})

test('no git, file, project, or settings op is reachable from a phone', () => {
  const forbidden = [
    'git.commit',
    'git.push',
    'git.openPullRequest',
    'files.read',
    'files.write',
    'projects.add',
    'runtimes.save',
    'integrations.create',
  ]
  for (const op of forbidden) {
    // Not in the op list at all, and denied even if someone forces the cast.
    assert.equal(MOBILE_OPS.includes(op as MobileOp), false, `${op} must not be a MobileOp`)
    assert.equal(mobileScopeAllows('control', op as MobileOp), false)
  }
})

test('MOBILE_OPS has no duplicates', () => {
  assert.equal(new Set(MOBILE_OPS).size, MOBILE_OPS.length)
})

test('the default scope is a recognised tag', () => {
  assert.equal(isMobileScope(DEFAULT_MOBILE_SCOPE), true)
})

test('summary labels every granted op and names what is off limits', () => {
  const { allowed, denied } = mobileScopeSummary('control')
  assert.equal(allowed.length, MOBILE_OPS.length)
  assert.ok(allowed.includes('Allow or deny tool approvals'))
  assert.ok(allowed.includes('Trigger a run now'))
  assert.ok(denied.includes('Commit, push, or open a pull request'))
  assert.ok(denied.includes('Edit runtimes or app settings'))
  // Reading source is in scope; changing it is never.
  assert.ok(allowed.includes('Read workspace files (read-only)'))
  assert.ok(denied.includes('Write or delete workspace files'))
  // Nothing may be both offered and refused.
  for (const label of allowed) assert.equal(denied.includes(label), false)
})

test('an unknown scope summarises as "allowed nothing"', () => {
  const { allowed, denied } = mobileScopeSummary('nope')
  assert.deepEqual(allowed, [])
  assert.ok(denied.length > 0)
})
