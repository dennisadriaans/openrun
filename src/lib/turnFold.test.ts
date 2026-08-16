import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { foldedRows, planTurnFold, workOverflow, type TurnRow } from './turnFold.ts'

const rows: TurnRow[] = [
  { id: 'a', kind: 'text' },
  { id: 'b', kind: 'work' },
  { id: 'c', kind: 'work' },
  { id: 'd', kind: 'text' },
]

test('a running turn never folds', () => {
  const plan = planTurnFold(rows, false)
  assert.equal(plan.foldable, false)
  assert.equal(plan.hiddenIds.size, 0)
})

test('a settled turn hides everything but its final answer', () => {
  const plan = planTurnFold(rows, true)
  assert.equal(plan.foldable, true)
  assert.deepEqual([...plan.hiddenIds].sort(), ['a', 'b', 'c'])
})

test('a turn without tool calls stays as written', () => {
  const plan = planTurnFold([{ id: 'a', kind: 'text' }], true)
  assert.equal(plan.foldable, false)
})

test('a turn that is only work folds all of it', () => {
  const plan = planTurnFold([{ id: 'b', kind: 'work' }], true)
  assert.equal(plan.foldable, true)
  assert.deepEqual([...plan.hiddenIds], ['b'])
})

const longRows: TurnRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, kind: 'work' as const })),
  { id: 'answer', kind: 'text' },
]

test('a closed fold shows only the final answer', () => {
  const plan = planTurnFold(longRows, true)
  const { visible, moreCount } = foldedRows(longRows, plan, 'closed', 5)
  assert.deepEqual(
    visible.map((r) => r.id),
    ['answer'],
  )
  assert.equal(moreCount, 3)
})

test('first open shows the latest hidden rows and counts the rest', () => {
  const plan = planTurnFold(longRows, true)
  const { visible, moreCount } = foldedRows(longRows, plan, 'partial', 5)
  assert.deepEqual(
    visible.map((r) => r.id),
    ['w3', 'w4', 'w5', 'w6', 'w7', 'answer'],
  )
  assert.equal(moreCount, 3)
})

test('the second open replays the whole turn and keeps the toggle count', () => {
  const plan = planTurnFold(longRows, true)
  const { visible, moreCount } = foldedRows(longRows, plan, 'all', 5)
  assert.equal(visible.length, longRows.length)
  assert.equal(moreCount, 3)
})

test('a short fold opens fully in one step', () => {
  const plan = planTurnFold(rows, true)
  const { visible, moreCount } = foldedRows(rows, plan, 'partial', 5)
  assert.equal(visible.length, rows.length)
  assert.equal(moreCount, 0)
})

test('an unfoldable turn draws every row', () => {
  const plain: TurnRow[] = [{ id: 'a', kind: 'text' }]
  const plan = planTurnFold(plain, true)
  assert.deepEqual(foldedRows(plain, plan, 'closed'), { visible: plain, moreCount: 0 })
})

test('short tool runs keep every row', () => {
  const entries = [{ id: '1' }, { id: '2' }]
  assert.deepEqual(workOverflow(entries, 5), { hidden: [], visible: entries })
})

test('long tool runs hide the oldest rows', () => {
  const entries = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }]
  const { hidden, visible } = workOverflow(entries, 2)
  assert.deepEqual(
    hidden.map((e) => e.id),
    ['1', '2'],
  )
  assert.deepEqual(
    visible.map((e) => e.id),
    ['3', '4'],
  )
})
