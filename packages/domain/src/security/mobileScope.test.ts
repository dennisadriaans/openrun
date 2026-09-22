import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_MOBILE_SCOPE,
  MOBILE_OPS,
  type MobileOp,
  isMobileScope,
  mobileScopeAllows,
  mobileScopeOps,
  mobileScopeOutdatedHint,
  mobileScopeSummary,
} from './mobileScope.ts'

test('the current scope grants every declared op', () => {
  for (const op of MOBILE_OPS) {
    assert.equal(mobileScopeAllows(DEFAULT_MOBILE_SCOPE, op), true, `expected ${op} allowed`)
  }
})

test('a shipped tag is frozen — control never gained the ops added after it', () => {
  // The point of a tag: a phone paired months ago keeps exactly the powers its
  // owner saw on the pairing screen. Widening adds a tag, it does not edit one.
  assert.equal(mobileScopeAllows('control', 'runs.create'), false)
  assert.equal(mobileScopeAllows('control', 'runs.startOptions'), false)
  // …while everything it did ship with still works.
  assert.equal(mobileScopeAllows('control', 'approvals.answer'), true)
  assert.equal(mobileScopeAllows('control', 'tasks.runNow'), true)
})

test('ops are exposed as ids so a client can feature-detect', () => {
  assert.deepEqual(mobileScopeOps(DEFAULT_MOBILE_SCOPE), [...MOBILE_OPS])
  assert.equal(mobileScopeOps('control').includes('runs.create'), false)
  assert.deepEqual(mobileScopeOps('nope'), [])
  // A caller mutating the answer must not reach the table behind it.
  const ops = mobileScopeOps('control')
  ops.push('runs.create')
  assert.equal(mobileScopeAllows('control', 'runs.create'), false)
})

test('an older tag says what pairing again would add', () => {
  const hint = mobileScopeOutdatedHint('control')
  assert.ok(hint)
  assert.match(hint ?? '', /Pair it again/)
  assert.match(hint ?? '', /start a new run/i)
  // Current and unknown tags have nothing to explain.
  assert.equal(mobileScopeOutdatedHint(DEFAULT_MOBILE_SCOPE), null)
  assert.equal(mobileScopeOutdatedHint('nope'), null)
})

test('an unknown scope tag denies everything', () => {
  for (const op of MOBILE_OPS) {
    assert.equal(mobileScopeAllows('admin', op), false)
    assert.equal(mobileScopeAllows('', op), false)
  }
})

test('a downgraded build does not honour a tag from the future', () => {
  assert.equal(isMobileScope('control-v3'), false)
  assert.equal(mobileScopeAllows('control-v3', 'runs.read'), false)
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
    assert.equal(mobileScopeAllows(DEFAULT_MOBILE_SCOPE, op as MobileOp), false)
  }
})

test('MOBILE_OPS has no duplicates', () => {
  assert.equal(new Set(MOBILE_OPS).size, MOBILE_OPS.length)
})

test('the default scope is a recognised tag', () => {
  assert.equal(isMobileScope(DEFAULT_MOBILE_SCOPE), true)
})

test('summary labels every granted op and names what is off limits', () => {
  const { allowed, denied } = mobileScopeSummary(DEFAULT_MOBILE_SCOPE)
  assert.equal(allowed.length, MOBILE_OPS.length)
  assert.ok(allowed.includes('Allow or deny tool approvals'))
  assert.ok(allowed.includes('Trigger a run now'))
  assert.ok(allowed.includes('Start a new run in an existing workspace'))
  assert.ok(denied.includes('Commit, push, or open a pull request'))
  assert.ok(denied.includes('Edit runtimes or app settings'))
  // Reading source is in scope; changing it is never.
  assert.ok(allowed.includes('Read workspace files (read-only)'))
  assert.ok(denied.includes('Write or delete workspace files'))
  // Nothing may be both offered and refused.
  for (const label of allowed) assert.equal(denied.includes(label), false)
})

test('an older tag summarises the new ops as denied', () => {
  const { allowed, denied } = mobileScopeSummary('control')
  assert.equal(allowed.includes('Start a new run in an existing workspace'), false)
  assert.ok(denied.includes('Start a new run in an existing workspace'))
})

test('an unknown scope summarises as "allowed nothing"', () => {
  const { allowed, denied } = mobileScopeSummary('nope')
  assert.deepEqual(allowed, [])
  assert.ok(denied.length > 0)
})
