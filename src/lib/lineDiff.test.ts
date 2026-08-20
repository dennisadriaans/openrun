import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { collapseContext, diffLines, lineDiffStats, splitChangeBlocks } from './lineDiff.ts'

test('identical text is all context', () => {
  const lines = diffLines('a\nb\n', 'a\nb\n')
  assert.deepEqual(
    lines.map((l) => l.type),
    ['context', 'context'],
  )
  assert.deepEqual(lineDiffStats(lines), { additions: 0, deletions: 0 })
})

test('a changed middle line reads as delete then add', () => {
  const lines = diffLines('a\nb\nc', 'a\nB\nc')
  assert.deepEqual(
    lines.map((l) => `${l.type}:${l.content}`),
    ['context:a', 'delete:b', 'add:B', 'context:c'],
  )
  assert.deepEqual(lineDiffStats(lines), { additions: 1, deletions: 1 })
})

test('line numbers count each side separately', () => {
  const lines = diffLines('a\nb', 'a\nx\nb')
  const added = lines.find((l) => l.type === 'add')
  assert.equal(added?.oldNumber, null)
  assert.equal(added?.newNumber, 2)
  assert.equal(lines.at(-1)?.oldNumber, 2)
  assert.equal(lines.at(-1)?.newNumber, 3)
})

test('an empty side is a whole-block insert or delete', () => {
  assert.deepEqual(
    diffLines('', 'a\nb').map((l) => l.type),
    ['add', 'add'],
  )
  assert.deepEqual(
    diffLines('a\nb', '').map((l) => l.type),
    ['delete', 'delete'],
  )
  assert.deepEqual(diffLines('', ''), [])
})

test('a trailing newline does not become an extra empty line', () => {
  assert.equal(diffLines('a\n', 'a\n').length, 1)
})

test('collapseContext elides unchanged runs and reports the gap', () => {
  const lines = diffLines(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x'].join('\n'),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'y'].join('\n'),
  )
  const rows = collapseContext(lines, 2)
  assert.deepEqual(
    rows.map((r) => r.line.content),
    ['8', '9', 'x', 'y'],
  )
  assert.equal(rows[0]?.skippedBefore, 7)
  assert.equal(rows[1]?.skippedBefore, 0)
})

test('collapseContext keeps everything when the diff is small', () => {
  const lines = diffLines('a\nb', 'a\nc')
  assert.equal(collapseContext(lines, 3).length, lines.length)
})

test('splitChangeBlocks yields one card per distant edit', () => {
  const lines = diffLines(
    ['A', '2', '3', '4', '5', '6', '7', '8', 'B'].join('\n'),
    ['a', '2', '3', '4', '5', '6', '7', '8', 'b'].join('\n'),
  )
  const blocks = splitChangeBlocks(lines, 1)
  assert.equal(blocks.length, 2)
  assert.ok(blocks[0]!.some((line) => line.content === 'A'))
  assert.ok(blocks[1]!.some((line) => line.content === 'B'))
})
