import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { elapsedLabel } from './format.ts'

const start = 1_700_000_000_000

test('elapsed reads in whole seconds under a minute', () => {
  assert.equal(elapsedLabel(start, start), '0s')
  assert.equal(elapsedLabel(start, start + 12_900), '12s')
  assert.equal(elapsedLabel(start, start + 59_999), '59s')
})

test('elapsed pads the seconds once it reads in minutes', () => {
  assert.equal(elapsedLabel(start, start + 60_000), '1m 00s')
  assert.equal(elapsedLabel(start, start + 125_000), '2m 05s')
})

test('elapsed rolls over to hours', () => {
  assert.equal(elapsedLabel(start, start + 3_600_000), '1h 00m')
  assert.equal(elapsedLabel(start, start + 3_900_000), '1h 05m')
})

test('a clock that went backwards reads as zero, not negative', () => {
  assert.equal(elapsedLabel(start, start - 5_000), '0s')
})
