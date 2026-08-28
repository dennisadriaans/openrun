import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foldedRows, planTurnFold } from './turnFold.ts'

test('a settled turn keeps edit cards visible next to the answer', () => {
  const rows = [
    { id: 'thought', kind: 'work' as const },
    { id: 'edit', kind: 'edit' as const },
    { id: 'answer', kind: 'text' as const },
  ]
  const plan = planTurnFold(rows, true)
  assert.equal(plan.foldable, true)
  assert.ok(plan.hiddenIds.has('thought'))
  assert.ok(!plan.hiddenIds.has('edit'))
  assert.ok(!plan.hiddenIds.has('answer'))
  const { visible } = foldedRows(rows, plan, 'closed')
  assert.deepEqual(
    visible.map((row) => row.id),
    ['edit', 'answer'],
  )
})

test('an in-flight turn hides its work but keeps the streaming answer', () => {
  const rows = [
    { id: 'thought', kind: 'work' as const },
    { id: 'answer', kind: 'text' as const },
  ]
  const plan = planTurnFold(rows, false)
  assert.equal(plan.foldable, true)
  assert.ok(plan.hiddenIds.has('thought'))
  assert.ok(!plan.hiddenIds.has('answer'))
  const { visible } = foldedRows(rows, plan, 'closed')
  assert.deepEqual(
    visible.map((row) => row.id),
    ['answer'],
  )
})

test('a turn with no tool work never folds', () => {
  const plan = planTurnFold([{ id: 'answer', kind: 'text' as const }], false)
  assert.equal(plan.foldable, false)
})
