import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  COMMIT_TYPE_NAMES,
  MAX_SUBJECT_LENGTH,
  commitBump,
  isReleaseCommitSubject,
  parseCommit,
  typeMeta,
  validateCommitTitle,
} from './conventional.ts'

const at = (subject: string, body?: string) =>
  parseCommit(body === undefined ? { sha: 'abc1234', subject } : { sha: 'abc1234', subject, body })

test('parses a squash subject with scope and PR number', () => {
  const commit = at('feat(tasks): select and bulk delete automations (#42)')
  assert.equal(commit.type, 'feat')
  assert.equal(commit.scope, 'tasks')
  assert.equal(commit.description, 'select and bulk delete automations')
  assert.equal(commit.pr, 42)
  assert.equal(commit.breaking, false)
})

test('parses a scopeless subject', () => {
  const commit = at('fix: remove useless info line (#21)')
  assert.equal(commit.type, 'fix')
  assert.equal(commit.scope, null)
  assert.equal(commit.description, 'remove useless info line')
  assert.equal(commit.pr, 21)
})

test('a subject with no PR suffix keeps its full description', () => {
  const commit = at('docs: document the release pipeline')
  assert.equal(commit.description, 'document the release pipeline')
  assert.equal(commit.pr, null)
})

test('recognises release commits before and after squash merge', () => {
  assert.equal(isReleaseCommitSubject('chore(release): v0.1.0', 'v0.1.0'), true)
  assert.equal(isReleaseCommitSubject('chore(release): v0.1.0 (#63)', 'v0.1.0'), true)
  assert.equal(isReleaseCommitSubject('chore(release): v0.1.1 (#64)', 'v0.1.0'), false)
  assert.equal(isReleaseCommitSubject('fix(release): v0.1.0 (#63)', 'v0.1.0'), false)
})

test('detects a breaking change from the bang', () => {
  assert.equal(at('feat!: replace runtime configuration schema').breaking, true)
  assert.equal(at('feat(runtimes)!: replace configuration schema').breaking, true)
})

test('detects a breaking change from the body footer', () => {
  assert.equal(at('feat: rework config', 'BREAKING CHANGE: the old keys are gone').breaking, true)
  assert.equal(at('feat: rework config', 'BREAKING-CHANGE: gone').breaking, true)
  assert.equal(at('feat: rework config', 'mentions BREAKING CHANGE: mid-line').breaking, false)
})

test('an unconventional subject parses as unknown rather than throwing', () => {
  const commit = at('Added scheduler thing (#7)')
  assert.equal(commit.type, null)
  assert.equal(commit.description, 'Added scheduler thing')
  assert.equal(commit.pr, 7)
  assert.equal(typeMeta(commit), null)
  assert.equal(commitBump(commit), null)
})

test('maps types to the bump they demand', () => {
  assert.equal(commitBump(at('feat: add linear trigger')), 'minor')
  assert.equal(commitBump(at('fix: repair scheduler')), 'patch')
  assert.equal(commitBump(at('perf: cache the catalog')), 'patch')
  assert.equal(commitBump(at('revert: undo the picker change')), 'patch')
})

test('housekeeping types alone never warrant a release', () => {
  for (const type of ['docs', 'chore', 'test', 'ci', 'build', 'refactor']) {
    assert.equal(commitBump(at(`${type}: something`)), null, type)
  }
})

test('a breaking marker outranks a type that would not release at all', () => {
  assert.equal(commitBump(at('refactor!: drop the legacy presets')), 'major')
  assert.equal(commitBump(at('chore!: remove the demo runtime')), 'major')
})

test('an unknown type is not silently treated as a chore', () => {
  const commit = at('wip: half a thing')
  assert.equal(commit.type, 'wip')
  assert.equal(typeMeta(commit), null)
  assert.equal(commitBump(commit), null)
})

test('the type list the PR-title gate accepts stays in sync', () => {
  assert.deepEqual([...COMMIT_TYPE_NAMES].sort(), [
    'build',
    'chore',
    'ci',
    'docs',
    'feat',
    'fix',
    'perf',
    'refactor',
    'revert',
    'test',
  ])
})

test('accepts titles that satisfy every commit rule', () => {
  for (const title of [
    'feat: add scheduler retry policy',
    'feat(tasks): select and bulk delete automations',
    'fix(cloud-relay): reconnect after a dropped socket',
    'feat!: replace runtime configuration schema',
    'chore(deps): bump better-sqlite3',
  ]) {
    assert.deepEqual(validateCommitTitle(title), { ok: true, error: null }, title)
  }
})

test('rejects a non-conventional title', () => {
  const verdict = validateCommitTitle('Added scheduler thing')
  assert.equal(verdict.ok, false)
  assert.match(verdict.error ?? '', /Not a conventional commit/)
})

test('rejects an unknown type', () => {
  assert.match(validateCommitTitle('wip: half a thing').error ?? '', /Unknown type "wip"/)
})

test('rejects a capitalised or full-stopped subject', () => {
  assert.match(validateCommitTitle('feat: Add the thing').error ?? '', /lowercase imperative/)
  assert.match(validateCommitTitle('feat: add the thing.').error ?? '', /trailing period/)
})

test('rejects a title over the length cap', () => {
  const long = `feat: ${'a'.repeat(MAX_SUBJECT_LENGTH)}`
  assert.match(validateCommitTitle(long).error ?? '', /the limit is 60/)
  // Exactly at the cap is fine.
  assert.equal(validateCommitTitle(`feat: ${'a'.repeat(MAX_SUBJECT_LENGTH - 6)}`).ok, true)
})

test('rejects a scope that is not a lowercase slug', () => {
  assert.match(validateCommitTitle('feat(Tasks): add a thing').error ?? '', /must be lowercase/)
})

test('a valid title parses back into the commit the release plan will see', () => {
  const title = 'feat(tasks): select and bulk delete automations'
  assert.equal(validateCommitTitle(title).ok, true)
  assert.equal(parseCommit({ sha: 'a', subject: title }).type, 'feat')
})
