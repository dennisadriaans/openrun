import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CommitInput } from './conventional.ts'
import { planRelease, summariseCounts } from './plan.ts'

const commits = (...subjects: string[]): CommitInput[] =>
  subjects.map((subject, index) => ({ sha: `sha${index}`, subject }))

test('feat in the range produces a minor', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('fix: repair scheduler', 'docs: update readme', 'feat: add linear trigger'),
  })

  assert.equal(plan.releasable, true)
  assert.equal(plan.next, '0.9.0')
  assert.equal(plan.tag, 'v0.9.0')
  assert.equal(plan.bump, 'minor')
  assert.equal(plan.held, null)
})

test('only fixes produce a patch', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('fix: a', 'perf: b', 'chore: c'),
  })

  assert.equal(plan.next, '0.8.2')
  assert.equal(plan.bump, 'patch')
})

test('a range of only housekeeping is not releasable', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('docs: a', 'chore: b', 'test: c', 'ci: d', 'refactor: e'),
  })

  assert.equal(plan.releasable, false)
  assert.equal(plan.next, null)
  assert.equal(plan.tag, null)
  assert.equal(plan.total, 5)
  assert.match(plan.reason, /none of them releasable/)
})

test('an empty range is not releasable and says so', () => {
  const plan = planRelease({ currentVersion: '0.8.1', commits: [] })

  assert.equal(plan.releasable, false)
  assert.equal(plan.reason, 'No commits since v0.8.1.')
  assert.equal(plan.total, 0)
})

test('a breaking change below 1.0 lands as a minor and is reported', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('feat!: replace runtime configuration schema', 'fix: b'),
  })

  assert.equal(plan.next, '0.9.0')
  assert.equal(plan.bump, 'minor')
  assert.equal(plan.requestedBump, 'major')
  assert.equal(plan.held, 'pre-1.0')
  assert.equal(plan.breaking.length, 1)
  assert.match(plan.reason, /pre-1\.0/)
})

test('past 1.0 a breaking change still needs an explicit opt-in', () => {
  const range = commits('feat!: replace the schema')

  const held = planRelease({ currentVersion: '1.4.0', commits: range })
  assert.equal(held.next, '1.5.0')
  assert.equal(held.held, 'policy')

  const allowed = planRelease({ currentVersion: '1.4.0', commits: range, allowMajor: true })
  assert.equal(allowed.next, '2.0.0')
  assert.equal(allowed.held, null)
})

test('groups commits into ordered changelog sections', () => {
  const plan = planRelease({
    currentVersion: '0.1.0',
    commits: commits('chore: c', 'fix: b', 'feat: a', 'docs: d'),
  })

  assert.deepEqual(
    plan.sections.map((section) => section.title),
    ['🚀 Features', '🩹 Fixes', '📖 Documentation', '🏡 Chore'],
  )
  assert.deepEqual(plan.counts, { chore: 1, fix: 1, feat: 1, docs: 1 })
})

test('unconventional commits are surfaced, never dropped or guessed at', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('Added scheduler thing', 'feat: add linear trigger'),
  })

  assert.equal(plan.unconventional.length, 1)
  assert.equal(plan.unconventional[0]?.description, 'Added scheduler thing')
  assert.equal(plan.counts.unknown, 1)
  assert.equal(plan.total, 2)
  assert.equal(plan.next, '0.9.0', 'the conventional commits still decide the version')
})

test('a range of only unconventional commits is not releasable', () => {
  const plan = planRelease({
    currentVersion: '0.8.1',
    commits: commits('Added a thing', 'Fixed another'),
  })

  assert.equal(plan.releasable, false)
  assert.equal(plan.unconventional.length, 2)
})

test('the same input always produces the same version', () => {
  const range = commits('feat: a', 'fix: b', 'chore: c')
  const first = planRelease({ currentVersion: '0.8.1', commits: range })
  const second = planRelease({ currentVersion: '0.8.1', commits: [...range].reverse() })

  assert.equal(first.next, second.next)
})

test('refuses a base version that is not SemVer', () => {
  assert.throws(
    () => planRelease({ currentVersion: 'main', commits: commits('feat: a') }),
    /not a SemVer version/,
  )
})

test('summariseCounts prints in changelog section order', () => {
  assert.equal(
    summariseCounts({ chore: 7, feat: 3, fix: 4, docs: 2, perf: 1 }),
    'feat 3 · fix 4 · perf 1 · docs 2 · chore 7',
  )
})

test('the first release publishes the current version rather than bumping past it', () => {
  const plan = planRelease({
    currentVersion: '0.1.0',
    commits: commits('feat: a', 'feat!: b', 'fix: c'),
    firstRelease: true,
  })

  assert.equal(plan.releasable, true)
  assert.equal(plan.next, '0.1.0')
  assert.equal(plan.tag, 'v0.1.0')
  assert.equal(plan.bump, null)
  assert.match(plan.reason, /^First release: v0\.1\.0/)
})

test('a first release still needs something releasable in the range', () => {
  const plan = planRelease({
    currentVersion: '0.1.0',
    commits: commits('docs: a', 'chore: b'),
    firstRelease: true,
  })

  assert.equal(plan.releasable, false)
})
