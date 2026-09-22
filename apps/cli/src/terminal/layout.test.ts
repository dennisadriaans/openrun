import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activityTable, cellWidth, fitLine, overviewTable } from './layout.ts'

test('footer and table rows fit narrow terminals, including wide characters and combining marks', () => {
  for (const width of [20, 32, 44, 60, 80, 120]) {
    const rows = [
      fitLine(
        'Tab accept   Enter send   ↑↓ history   Ctrl+C copy/clear   日本語 👨‍👩‍👦 café',
        width,
      ),
      ...overviewTable({ scheduled: 12, runs: 6, running: 2, integrations: 3 }, width).split('\n'),
      ...activityTable(
        [{ id: 'a', prompt: 'Create 日本語.html with contents 123', when: 'Preparing schedule' }],
        width,
      ).split('\n'),
    ]
    for (const row of rows) assert.ok(cellWidth(row) <= width, `${width}: ${row}`)
  }
  assert.equal(fitLine('a\nb\x1b[31mc', 10), 'a bc')
  assert.equal(cellWidth('👨‍👩‍👦'), 2)
  assert.equal(cellWidth('café'), 4)
})
