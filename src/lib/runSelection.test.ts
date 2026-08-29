import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizeRunPage,
  normalizeRunSelection,
  pageSelectionState,
  runPageNormalizationTarget,
  toggleRunSelection,
} from './runSelection.ts'

const runs = [
  { id: 'done', status: 'success' },
  { id: 'live', status: 'running' },
  { id: 'failed', status: 'error' },
]

describe('run selection', () => {
  it('keeps only visible non-running ids and removes duplicates', () => {
    assert.deepEqual(normalizeRunSelection(['done', 'missing', 'done', 'live'], runs), ['done'])
  })

  it('returns the existing selection when normalization makes no changes', () => {
    const selected = ['done']
    assert.strictEqual(normalizeRunSelection(selected, runs), selected)
  })

  it('reports select-all checked and indeterminate states for deletable rows', () => {
    assert.deepEqual(pageSelectionState([], runs), {
      ids: ['done', 'failed'],
      checked: false,
      indeterminate: false,
    })
    assert.deepEqual(pageSelectionState(['done'], runs), {
      ids: ['done', 'failed'],
      checked: false,
      indeterminate: true,
    })
    assert.deepEqual(pageSelectionState(['done', 'failed'], runs), {
      ids: ['done', 'failed'],
      checked: true,
      indeterminate: false,
    })
  })

  it('toggles one id without duplicating it', () => {
    assert.deepEqual(toggleRunSelection(['done'], 'done', true), ['done'])
    assert.deepEqual(toggleRunSelection(['done'], 'done', false), [])
    assert.deepEqual(toggleRunSelection(['done'], 'failed', true), ['done', 'failed'])
  })

  it('normalizes out-of-range pages, including an empty result', () => {
    assert.equal(normalizeRunPage(4, 21, 10), 3)
    assert.equal(normalizeRunPage(2, 0, 10), 1)
    assert.equal(normalizeRunPage(0, 12, 10), 1)
  })

  it('waits for an authoritative count before normalizing page 2', () => {
    assert.equal(
      runPageNormalizationTarget({
        page: 2,
        total: 0,
        pageSize: 10,
        countReady: false,
        rowsLoaded: false,
        rowCount: 0,
      }),
      null,
    )
  })

  it('normalizes against authoritative nonempty and empty counts', () => {
    assert.equal(
      runPageNormalizationTarget({
        page: 4,
        total: 21,
        pageSize: 10,
        countReady: true,
        rowsLoaded: false,
        rowCount: 0,
      }),
      3,
    )
    assert.equal(
      runPageNormalizationTarget({
        page: 2,
        total: 0,
        pageSize: 10,
        countReady: true,
        rowsLoaded: false,
        rowCount: 0,
      }),
      1,
    )
  })

  it('steps back from an empty loaded page after its last row is deleted', () => {
    assert.equal(
      runPageNormalizationTarget({
        page: 3,
        total: 21,
        pageSize: 10,
        countReady: true,
        rowsLoaded: true,
        rowCount: 0,
      }),
      2,
    )
    assert.equal(
      runPageNormalizationTarget({
        page: 2,
        total: 21,
        pageSize: 10,
        countReady: true,
        rowsLoaded: true,
        rowCount: 2,
      }),
      null,
    )
  })
})
