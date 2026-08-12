import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeRunRef, normalizeText, parseCommand } from './commands.ts'

test('normalizeText strips Slack wire formatting', () => {
  assert.equal(normalizeText('<@U123456> runs'), 'runs')
  assert.equal(normalizeText('<@U123|dennis> status'), 'status')
  assert.equal(normalizeText('<#C0001|general> runs'), 'runs')
  assert.equal(
    normalizeText('open <https://example.com|example.com>'),
    'open https://example.com',
  )
})

test('normalizeText undoes mobile keyboard substitutions', () => {
  // iOS smart quotes would otherwise make `don't` unmatchable against a literal.
  assert.equal(normalizeText('say #1 don’t touch the tests'), "say #1 don't touch the tests")
  assert.equal(normalizeText('say #1 “ship it”'), 'say #1 "ship it"')
  assert.equal(normalizeText('runs active'), 'runs active')
})

test('bare and aliased verbs parse', () => {
  assert.deepEqual(parseCommand({ text: '' }), { kind: 'help' })
  assert.deepEqual(parseCommand({ text: 'help' }), { kind: 'help' })
  assert.deepEqual(parseCommand({ text: '?' }), { kind: 'help' })
  assert.deepEqual(parseCommand({ text: 'status' }), { kind: 'status' })
  assert.deepEqual(parseCommand({ text: 's' }), { kind: 'status' })
  assert.deepEqual(parseCommand({ text: 'automations' }), { kind: 'automations' })
  assert.deepEqual(parseCommand({ text: 'a' }), { kind: 'automations' })
})

test('runs takes an optional filter and limit in either order', () => {
  assert.deepEqual(parseCommand({ text: 'runs' }), { kind: 'runs', filter: 'active', limit: 8 })
  assert.deepEqual(parseCommand({ text: 'runs all 20' }), {
    kind: 'runs',
    filter: 'all',
    limit: 20,
  })
  assert.deepEqual(parseCommand({ text: 'r 3 failed' }), {
    kind: 'runs',
    filter: 'failed',
    limit: 3,
  })
})

test('runs limit is clamped to something a phone can read', () => {
  const parsed = parseCommand({ text: 'runs all 999' })
  assert.deepEqual(parsed, { kind: 'runs', filter: 'all', limit: 25 })
})

test('`run now <name>` starts an automation but `run #1` opens a run', () => {
  assert.deepEqual(parseCommand({ text: 'run now nightly docs' }), {
    kind: 'run_now',
    ref: 'nightly docs',
  })
  assert.deepEqual(parseCommand({ text: 'run #1' }), { kind: 'run_detail', ref: '#1' })
  assert.deepEqual(parseCommand({ text: 'start nightly docs' }), {
    kind: 'run_now',
    ref: 'nightly docs',
  })
})

test('enable and disable carry a multi-word automation name', () => {
  assert.deepEqual(parseCommand({ text: 'disable nightly docs sweep' }), {
    kind: 'set_enabled',
    ref: 'nightly docs sweep',
    enabled: false,
  })
  assert.deepEqual(parseCommand({ text: 'on nightly docs sweep' }), {
    kind: 'set_enabled',
    ref: 'nightly docs sweep',
    enabled: true,
  })
})

test('a verb that needs a target says so instead of guessing', () => {
  assert.deepEqual(parseCommand({ text: 'cancel' }), {
    kind: 'needs_ref',
    verb: 'cancel',
    hint: 'cancel #1',
  })
  assert.deepEqual(parseCommand({ text: 'disable' }), {
    kind: 'needs_ref',
    verb: 'disable',
    hint: 'disable <automation name>',
  })
})

test('say targets an explicit run or falls back to the thread', () => {
  assert.deepEqual(parseCommand({ text: 'say #2 keep going' }), {
    kind: 'say',
    ref: '#2',
    text: 'keep going',
  })
  assert.deepEqual(parseCommand({ text: 'say keep going', threadRunId: 'run_abc' }), {
    kind: 'say',
    ref: 'run_abc',
    text: 'keep going',
  })
})

test('say without any run to talk to asks for one', () => {
  // `keep` is not ref-shaped, so there is no target and nothing is sent.
  assert.deepEqual(parseCommand({ text: 'say keep going' }), {
    kind: 'needs_ref',
    verb: 'say',
    hint: 'say #1 <message>',
  })
  assert.deepEqual(parseCommand({ text: 'say' }), {
    kind: 'needs_ref',
    verb: 'say',
    hint: 'say #1 <message>',
  })
})

test('say with a target but no words does not send an empty turn', () => {
  assert.deepEqual(parseCommand({ text: 'say #1' }), {
    kind: 'needs_ref',
    verb: 'say',
    hint: 'say #1 <message>',
  })
})

test('bare text in a run thread becomes that run’s next turn', () => {
  // The one-handed path: no verb, no run id, just talk to the agent.
  assert.deepEqual(
    parseCommand({ text: 'actually revert the last commit', threadRunId: 'run_abc' }),
    { kind: 'say', ref: 'run_abc', text: 'actually revert the last commit' },
  )
})

test('bare text outside a thread is not silently sent anywhere', () => {
  assert.deepEqual(parseCommand({ text: 'actually revert the last commit' }), {
    kind: 'unknown',
    input: 'actually revert the last commit',
  })
})

test('approve and deny map onto one intent with a decision', () => {
  assert.deepEqual(parseCommand({ text: 'approve #1' }), {
    kind: 'approve',
    ref: '#1',
    decision: 'allow',
  })
  assert.deepEqual(parseCommand({ text: 'y', threadRunId: 'run_abc' }), {
    kind: 'approve',
    ref: 'run_abc',
    decision: 'allow',
  })
  assert.deepEqual(parseCommand({ text: 'no', threadRunId: 'run_abc' }), {
    kind: 'approve',
    ref: 'run_abc',
    decision: 'deny',
  })
})

test('a verb still wins over thread context', () => {
  // In run_abc's thread, `cancel #4` must cancel #4 — not the thread's run.
  assert.deepEqual(parseCommand({ text: 'cancel #4', threadRunId: 'run_abc' }), {
    kind: 'cancel',
    ref: '#4',
  })
})

test('mention prefix is stripped before the verb is read', () => {
  assert.deepEqual(parseCommand({ text: '<@U0BOT> runs failed', source: 'mention' }), {
    kind: 'runs',
    filter: 'failed',
    limit: 8,
  })
})

test('looksLikeRunRef accepts the shapes a phone can type', () => {
  assert.equal(looksLikeRunRef('#3'), true)
  assert.equal(looksLikeRunRef('3'), true)
  assert.equal(looksLikeRunRef('run_ma1b2c3d'), true)
  assert.equal(looksLikeRunRef('last'), true)
  assert.equal(looksLikeRunRef('nightly'), false)
  assert.equal(looksLikeRunRef(''), false)
})
