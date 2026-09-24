import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTO_SHIP_PROMPT_APPENDIX,
  PR_PROMPT_APPENDIX,
  canOpenPullRequests,
  withPrCapability,
} from './prCapability.ts'

test('capability disabled never allows PRs', () => {
  assert.equal(canOpenPullRequests(false, 'full-access'), false)
  assert.equal(canOpenPullRequests(false, 'approval-required'), false)
})

test('capability enabled allows non-supervised modes', () => {
  assert.equal(canOpenPullRequests(true, 'full-access'), true)
  assert.equal(canOpenPullRequests(true, 'auto-accept-edits'), true)
})

test('supervised is excluded even when capability is on', () => {
  assert.equal(canOpenPullRequests(true, 'approval-required'), false)
})

test('withPrCapability appends only when eligible', () => {
  assert.equal(withPrCapability('do the thing', false, 'full-access'), 'do the thing')
  assert.equal(withPrCapability('do the thing', true, 'approval-required'), 'do the thing')
  const appended = withPrCapability('do the thing', true, 'full-access')
  assert.ok(appended.startsWith('do the thing'))
  assert.ok(appended.includes(PR_PROMPT_APPENDIX.trim()))
})

test('an executor-shipped run tells the agent to leave shipping alone', () => {
  const appended = withPrCapability('do the thing', true, 'full-access', true)
  assert.ok(appended.includes(AUTO_SHIP_PROMPT_APPENDIX.trim()))
  assert.ok(!appended.includes(PR_PROMPT_APPENDIX.trim()))
  assert.equal(withPrCapability('do the thing', false, 'full-access', true), 'do the thing')
})
