import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeSelection, selectionState, toggleSelection } from './listSelection.ts'

const selectable = ['a', 'b']

describe('list selection', () => {
  it('keeps only selectable ids and removes duplicates', () => {
    assert.deepEqual(normalizeSelection(['a', 'gone', 'a'], selectable), ['a'])
  })

  it('returns the existing selection when normalization makes no changes', () => {
    const selected = ['a']
    assert.strictEqual(normalizeSelection(selected, selectable), selected)
  })

  it('reports checked and indeterminate states', () => {
    assert.deepEqual(selectionState([], selectable), {
      ids: ['a', 'b'],
      checked: false,
      indeterminate: false,
    })
    assert.deepEqual(selectionState(['a'], selectable), {
      ids: ['a', 'b'],
      checked: false,
      indeterminate: true,
    })
    assert.deepEqual(selectionState(['a', 'b'], selectable), {
      ids: ['a', 'b'],
      checked: true,
      indeterminate: false,
    })
  })

  it('reports nothing checked when there is nothing to select', () => {
    assert.deepEqual(selectionState([], []), { ids: [], checked: false, indeterminate: false })
  })

  it('adds and removes a single id', () => {
    assert.deepEqual(toggleSelection(['a'], 'b', true), ['a', 'b'])
    assert.deepEqual(toggleSelection(['a', 'b'], 'a', false), ['b'])
  })
})
