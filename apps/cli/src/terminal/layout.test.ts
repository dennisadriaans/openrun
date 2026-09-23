import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  activityCells,
  activityColumns,
  cardDetail,
  cellWidth,
  fitLine,
  minPaneWidth,
  overviewTable,
  splitAt,
  splitColumns,
  statusIcon,
  stepSplit,
} from './layout.ts'
import { relativeTime, repeatLabel } from './schedule.ts'

test('footer and table rows fit narrow terminals, including wide characters and combining marks', () => {
  for (const width of [20, 32, 44, 60, 80, 120]) {
    const rows = [
      fitLine(
        'Tab accept   Enter send   ↑↓ history   Ctrl+C copy/clear   日本語 👨‍👩‍👦 café',
        width,
      ),
      ...overviewTable({ scheduled: 12, runs: 6, running: 2, integrations: 3 }, width).split('\n'),
    ]
    for (const row of rows) assert.ok(cellWidth(row) <= width, `${width}: ${row}`)
  }
  assert.equal(fitLine('a\nb\x1b[31mc', 10), 'a bc')
  assert.equal(cellWidth('👨‍👩‍👦'), 2)
  assert.equal(cellWidth('café'), 4)
})

test('an Activity row is one line: status, time, prompt and changes, the prompt shortened first', () => {
  const items = [
    { status: 'Scheduled', time: '10:24', prompt: 'create new file "testabc.txt" with contents' },
    {
      status: 'Success',
      time: '09:15:02',
      prompt: 'fix the flaky test\nin   ci',
      model: 'claude-sonnet-5',
      effort: 'low',
      changes: { files: 2, additions: 12, deletions: 3 },
    },
  ]
  const columns = activityColumns(items)
  assert.deepEqual(columns, { status: 9, time: 8 })
  for (const width of [30, 44, 80]) {
    for (const item of items) {
      const cells = activityCells(item, columns, width)
      const row = `${cells.status}  ${cells.time ? `${cells.time}  ` : ''}${cells.prompt}${cells.changes ? `  ${cells.changes}` : ''}`
      assert.ok(cellWidth(cells.prompt) >= 5, `${width}: ${row}`)
      assert.ok(cellWidth(row) <= width, `${width}: ${row}`)
      assert.doesNotMatch(row, /claude|effort/)
    }
  }
  const wide = activityCells(items[1]!, columns, 80)
  assert.equal(wide.status, 'Success  ')
  assert.equal(wide.prompt, 'fix the flaky test in ci')
  assert.equal(wide.changes, '2 files +12 −3')
})

test('a chat card says when, which model and how hard, and stops counting down once it runs', () => {
  const now = Date.parse('2026-09-23T10:24:00Z')
  const card = {
    status: 'Scheduled',
    title: 'testabc.txt',
    at: now + 10_000,
    model: 'claude-sonnet-5',
    effort: 'low',
  }
  assert.equal(cardDetail(card, 'Scheduled', now), 'in 10 seconds · claude-sonnet-5 · low effort')
  assert.equal(cardDetail(card, 'Running', now), 'claude-sonnet-5 · low effort')
  assert.equal(cardDetail({ status: 'Running', title: 'x' }), 'default model')
  assert.equal(
    cardDetail({ status: 'Scheduled', title: 'x', repeats: repeatLabel('0 9 * * 1') }),
    'every Monday · default model',
  )
  assert.equal(relativeTime(now - 1, now), 'now')
  assert.equal(relativeTime(now + 90 * 60_000, now), 'in 2 hours')
  assert.equal(relativeTime(now + 86_400_000, now), 'tomorrow')
  assert.deepEqual(['Scheduled', 'Running', 'Queued', 'Failed', 'Success'].map(statusIcon), [
    '✓',
    '●',
    '○',
    '✗',
    '✓',
  ])
})

test('the chat | Activity split follows the ratio but keeps both panes readable', () => {
  assert.deepEqual(splitColumns(0.5, 99), { chat: 49, activity: 49 })
  assert.deepEqual(splitColumns(0.7, 101), { chat: 70, activity: 30 })
  for (const width of [72, 100, 200]) {
    for (const ratio of [-1, 0, 0.1, 0.5, 0.9, 1, 2, Number.NaN]) {
      const { chat, activity } = splitColumns(ratio, width)
      assert.equal(chat + activity + 1, width, `${width} ${ratio}`)
      assert.ok(chat >= minPaneWidth && activity >= minPaneWidth, `${width} ${ratio}`)
    }
  }
  assert.deepEqual(splitColumns(0.9, 31), { chat: 15, activity: 15 })
})

test('dragging the divider asks for the ratio under the pointer, clamped to the minimum', () => {
  assert.equal(splitColumns(splitAt(61, 1, 101), 101).chat, 60)
  assert.equal(splitColumns(splitAt(0, 1, 101), 101).chat, minPaneWidth)
  assert.equal(splitColumns(splitAt(500, 1, 101), 101).activity, minPaneWidth)
})

test('Ctrl+Shift+←/→ moves the divider one step from where it is drawn', () => {
  assert.equal(splitColumns(stepSplit(0.5, 101, 1), 101).chat, 55)
  assert.equal(splitColumns(stepSplit(0.5, 101, -1), 101).chat, 45)
  // A ratio the minimum overrode still moves on the first press back.
  assert.equal(splitColumns(stepSplit(0.99, 101, -1), 101).chat, 71)
  assert.equal(splitColumns(stepSplit(0, 101, -1), 101).chat, minPaneWidth)
})
