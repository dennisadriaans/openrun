import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CLONE_TIMEOUT_MS,
  PR_CREATE_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  SETUP_TIMEOUT_MS,
  commandOutputTooLargeMessage,
  commandTimedOutMessage,
} from './commandBudget.ts'

describe('command budgets', () => {
  it('gives every budgeted command a positive, finite budget', () => {
    for (const ms of [CLONE_TIMEOUT_MS, SETUP_TIMEOUT_MS, PUSH_TIMEOUT_MS, PR_CREATE_TIMEOUT_MS]) {
      assert.ok(Number.isFinite(ms) && ms > 0)
    }
  })

  it('gives slow network work more room than a couple of API calls', () => {
    // Ordering is the point: a cold clone is legitimately slow, `gh pr create`
    // has no business taking a minute.
    assert.ok(SETUP_TIMEOUT_MS > CLONE_TIMEOUT_MS)
    assert.ok(CLONE_TIMEOUT_MS > PUSH_TIMEOUT_MS)
    assert.ok(PUSH_TIMEOUT_MS > PR_CREATE_TIMEOUT_MS)
  })
})

describe('commandTimedOutMessage', () => {
  it('names the command, the budget and what to do next', () => {
    const message = commandTimedOutMessage('git clone', 10 * 60_000)
    assert.match(message, /^git clone/)
    assert.match(message, /10 minutes/)
    assert.match(message, /Run it yourself/)
  })

  it('uses the singular for a one-minute budget', () => {
    assert.match(commandTimedOutMessage('gh pr create', 60_000), /1 minute /)
  })

  it('keeps a fractional budget readable', () => {
    assert.match(commandTimedOutMessage('a command', 90_000), /1\.5 minutes/)
  })
})

describe('commandOutputTooLargeMessage', () => {
  it('names the command and says what to do', () => {
    const message = commandOutputTooLargeMessage('The setup command')
    assert.match(message, /^The setup command/)
    assert.match(message, /redirect its output/)
  })
})
