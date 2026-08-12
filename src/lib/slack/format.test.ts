import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  codeBlock,
  durationLabel,
  escapeMrkdwn,
  relativeTime,
  slackLink,
  statusEmoji,
  truncate,
} from './format.ts'

test('escapeMrkdwn neutralises the three characters Slack eats', () => {
  assert.equal(escapeMrkdwn('a & b'), 'a &amp; b')
  assert.equal(escapeMrkdwn('<script>'), '&lt;script&gt;')
  // Ampersand must be escaped first or the entities get double-escaped.
  assert.equal(escapeMrkdwn('&lt;'), '&amp;lt;')
})

test('slackLink cannot be broken out of by its label', () => {
  assert.equal(slackLink('https://x/y', 'run 1'), '<https://x/y|run 1>')
  assert.equal(slackLink('https://x', 'a|b>c'), '<https://x|a b c>')
})

test('truncate keeps the head and marks the cut', () => {
  assert.equal(truncate('abcdef', 10), 'abcdef')
  assert.equal(truncate('abcdef', 4), 'abc…')
  assert.equal(truncate('abcdef', 0), '')
})

test('codeBlock keeps the tail of a long log', () => {
  // The end of a log is where the failure is.
  const block = codeBlock('x'.repeat(50) + 'FAILED', 40)
  assert.ok(block.startsWith('```\n'))
  assert.ok(block.endsWith('\n```'))
  assert.ok(block.includes('FAILED'))
  assert.ok(block.length <= 40)
})

test('codeBlock renders empty output as a placeholder', () => {
  assert.equal(codeBlock(''), '```\n(empty)\n```')
})

test('a verdict outranks the status that carries it', () => {
  // A run can exit 0 and still have failed its checks.
  assert.equal(statusEmoji('success', 'failed-checks'), ':warning:')
  assert.equal(statusEmoji('success'), ':white_check_mark:')
  assert.equal(statusEmoji('running'), ':hourglass_flowing_sand:')
  assert.equal(statusEmoji('nonsense'), ':grey_question:')
})

test('relativeTime is compact enough for a phone', () => {
  const now = 1_000_000_000_000
  assert.equal(relativeTime(now - 5_000, now), 'just now')
  assert.equal(relativeTime(now - 4 * 60_000, now), '4m ago')
  assert.equal(relativeTime(now - 3 * 3_600_000, now), '3h ago')
  assert.equal(relativeTime(now - 2 * 86_400_000, now), '2d ago')
  assert.equal(relativeTime(null, now), 'unknown')
  assert.equal(relativeTime(now + 60_000, now), 'scheduled')
})

test('durationLabel measures a live run against now', () => {
  const now = 1_000_000_000_000
  assert.equal(durationLabel(now - 30_000, null, now), '30s')
  assert.equal(durationLabel(now - 90_000, null, now), '1m 30s')
  assert.equal(durationLabel(now - 3_720_000, null, now), '1h 2m')
  assert.equal(durationLabel(now - 60_000, now - 30_000, now), '30s')
  assert.equal(durationLabel(null, null, now), '')
})
