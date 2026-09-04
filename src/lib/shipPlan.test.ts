import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildShipPlanPrompt,
  commitMessageText,
  commitSubjectProblem,
  fallbackShipPlan,
  parseShipPlan,
  shipPlanProblem,
} from './shipPlan.ts'

test('commitSubjectProblem accepts a conventional subject', () => {
  assert.equal(commitSubjectProblem('feat(runs): add one-click ship'), null)
  assert.equal(commitSubjectProblem('fix: stop double commit'), null)
  assert.equal(commitSubjectProblem('feat(api)!: drop legacy route'), null)
})

test('commitSubjectProblem rejects the ways agents get it wrong', () => {
  assert.match(commitSubjectProblem('added a thing') ?? '', /type\(scope\)/)
  assert.match(commitSubjectProblem('feat: Add a thing') ?? '', /lowercase imperative/)
  assert.match(commitSubjectProblem('feat: add a thing.') ?? '', /end with a period/)
  assert.match(commitSubjectProblem(`feat: ${'x'.repeat(60)}`) ?? '', /longer than 60/)
  assert.match(commitSubjectProblem('feat: a\nb') ?? '', /single line/)
  assert.match(commitSubjectProblem('   ') ?? '', /empty/)
})

test('parseShipPlan reads a plan out of noisy stdout', () => {
  const raw = `Here you go:\n{"commits":[{"message":"feat: add ship","body":"why","paths":["a.ts"]}],"prTitle":"feat: add ship","prBody":"## Summary"}\nDone.`
  const plan = parseShipPlan(raw)
  assert.ok(plan)
  assert.equal(plan.commits.length, 1)
  assert.equal(plan.commits[0]?.body, 'why')
  assert.deepEqual(plan.commits[0]?.paths, ['a.ts'])
  assert.equal(plan.prTitle, 'feat: add ship')
})

test('parseShipPlan returns null rather than a half-understood plan', () => {
  assert.equal(parseShipPlan('no json here'), null)
  assert.equal(parseShipPlan('{ not json'), null)
  assert.equal(parseShipPlan('{"commits":[]}'), null)
  assert.equal(parseShipPlan('{"commits":[{"message":"feat: x","paths":[]}]}'), null)
})

test('shipPlanProblem accepts a plan that covers every changed file exactly once', () => {
  const plan = {
    commits: [
      { message: 'feat: add a', paths: ['a.ts'] },
      { message: 'fix: correct b', paths: ['b.ts'] },
    ],
    prTitle: 'feat: add a and fix b',
    prBody: '## Summary',
  }
  assert.equal(shipPlanProblem(plan, ['a.ts', 'b.ts']), null)
})

test('shipPlanProblem refuses invented, duplicated, or missing paths', () => {
  const base = { prTitle: 'feat: x', prBody: '' }
  assert.match(
    shipPlanProblem({ ...base, commits: [{ message: 'feat: x', paths: ['ghost.ts'] }] }, [
      'a.ts',
    ]) ?? '',
    /not a changed file/,
  )
  assert.match(
    shipPlanProblem(
      {
        ...base,
        commits: [
          { message: 'feat: x', paths: ['a.ts'] },
          { message: 'fix: y', paths: ['a.ts'] },
        ],
      },
      ['a.ts'],
    ) ?? '',
    /more than one commit/,
  )
  assert.match(
    shipPlanProblem({ ...base, commits: [{ message: 'feat: x', paths: ['a.ts'] }] }, [
      'a.ts',
      'b.ts',
    ]) ?? '',
    /leaves 1 changed file uncommitted/,
  )
})

test('shipPlanProblem holds the PR title to the same rules as a commit', () => {
  const commits = [{ message: 'feat: add a', paths: ['a.ts'] }]
  assert.match(
    shipPlanProblem({ commits, prTitle: '', prBody: '' }, ['a.ts']) ?? '',
    /no pull request title/,
  )
  assert.match(
    shipPlanProblem({ commits, prTitle: 'Added a thing', prBody: '' }, ['a.ts']) ?? '',
    /type\(scope\)/,
  )
})

test('commitMessageText joins subject and body with a blank line', () => {
  assert.equal(commitMessageText({ message: 'feat: x', paths: [] }), 'feat: x')
  assert.equal(commitMessageText({ message: 'feat: x', paths: [], body: 'why' }), 'feat: x\n\nwhy')
})

test('fallbackShipPlan is itself a valid plan', () => {
  const plan = fallbackShipPlan({ taskName: 'Tidy the runtimes page.', changed: ['a.ts', 'b.ts'] })
  assert.equal(shipPlanProblem(plan, ['a.ts', 'b.ts']), null)
  const empty = fallbackShipPlan({ taskName: '', changed: ['a.ts'] })
  assert.equal(shipPlanProblem(empty, ['a.ts']), null)
})

test('buildShipPlanPrompt lists the files and forbids editing', () => {
  const prompt = buildShipPlanPrompt({
    files: [{ path: 'a.ts', status: 'modified', additions: 3, deletions: 1 }],
    diff: 'diff --git a/a.ts',
    taskName: 'Add ship button',
    baseBranch: 'main',
  })
  assert.match(prompt, /a\.ts \(modified, \+3\/-1\)/)
  assert.match(prompt, /Do NOT edit/)
  assert.match(prompt, /Add ship button/)
  assert.match(prompt, /main/)
})
