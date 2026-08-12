import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRunRef, resolveTaskRef, type RunCandidate, type TaskCandidate } from './refs.ts'

const runs: RunCandidate[] = [
  { id: 'run_aaa111', ordinal: 1, taskName: 'nightly docs', status: 'running' },
  { id: 'run_bbb222', ordinal: 2, taskName: 'flaky test hunt', status: 'success' },
  { id: 'run_ccc333', ordinal: 3, taskName: 'nightly deps', status: 'failed' },
]

test('a run is addressable by the number shown in the list', () => {
  assert.deepEqual(resolveRunRef('#2', runs), { ok: true, value: 'run_bbb222' })
  assert.deepEqual(resolveRunRef('2', runs), { ok: true, value: 'run_bbb222' })
})

test('last resolves to the newest run regardless of list order', () => {
  const shuffled = [runs[2], runs[0], runs[1]]
  assert.deepEqual(resolveRunRef('last', shuffled), { ok: true, value: 'run_aaa111' })
  assert.deepEqual(resolveRunRef('latest', runs), { ok: true, value: 'run_aaa111' })
})

test('a full id and a unique id prefix both resolve', () => {
  assert.deepEqual(resolveRunRef('run_bbb222', runs), { ok: true, value: 'run_bbb222' })
  assert.deepEqual(resolveRunRef('run_bbb', runs), { ok: true, value: 'run_bbb222' })
})

test('an ambiguous name is reported, never guessed', () => {
  // Steering the wrong run is worse than asking again.
  const result = resolveRunRef('nightly', runs)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /matches 2 runs/)
})

test('a unique name substring resolves', () => {
  assert.deepEqual(resolveRunRef('flaky', runs), { ok: true, value: 'run_bbb222' })
})

test('out-of-range and unknown references explain themselves', () => {
  const missing = resolveRunRef('#9', runs)
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.reason, /no run #9/)

  const unknown = resolveRunRef('zzz', runs)
  assert.equal(unknown.ok, false)
  assert.match(unknown.ok ? '' : unknown.reason, /Could not find a run/)
})

test('resolving against an empty list says so', () => {
  const result = resolveRunRef('#1', [])
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /no runs/)
})

const tasks: TaskCandidate[] = [
  { id: 'task_1', name: 'Nightly docs sweep' },
  { id: 'task_2', name: 'Nightly deps bump' },
  { id: 'task_3', name: 'Flaky test hunt' },
]

test('an automation resolves by exact name, case-insensitively', () => {
  assert.deepEqual(resolveTaskRef('nightly docs sweep', tasks), { ok: true, value: 'task_1' })
})

test('an automation resolves by unique prefix or substring', () => {
  assert.deepEqual(resolveTaskRef('flaky', tasks), { ok: true, value: 'task_3' })
  assert.deepEqual(resolveTaskRef('Nightly docs', tasks), { ok: true, value: 'task_1' })
})

test('an ambiguous automation lists the candidates', () => {
  const result = resolveTaskRef('nightly', tasks)
  assert.equal(result.ok, false)
  assert.match(result.ok ? '' : result.reason, /matches 2 automations/)
  assert.match(result.ok ? '' : result.reason, /Nightly docs sweep/)
})

test('an exact name still wins when it is also a prefix of another', () => {
  const overlapping: TaskCandidate[] = [
    { id: 'task_a', name: 'deploy' },
    { id: 'task_b', name: 'deploy staging' },
  ]
  assert.deepEqual(resolveTaskRef('deploy', overlapping), { ok: true, value: 'task_a' })
})

test('an automation resolves by id', () => {
  assert.deepEqual(resolveTaskRef('task_2', tasks), { ok: true, value: 'task_2' })
})
