import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHandoffPrompt, handoffSystemNote } from './handoffPrompt.ts'

const messages = [
  { role: 'user' as const, content: 'add a health endpoint' },
  { role: 'assistant' as const, content: 'added src/routes/health.ts' },
]

test('returns the prompt untouched when there is nothing to hand over', () => {
  assert.equal(
    buildHandoffPrompt({ fromLabel: 'Claude', toLabel: 'Codex', messages: [], prompt: 'go on' }),
    'go on',
  )
})

test('carries the transcript, the files, and the new prompt', () => {
  const out = buildHandoffPrompt({
    fromLabel: 'Claude',
    toLabel: 'Codex',
    messages,
    files: ['src/routes/health.ts'],
    prompt: 'now add a test',
  })
  assert.match(out, /running on Claude/)
  assert.match(out, /User: add a health endpoint/)
  assert.match(out, /Previous agent: added src\/routes\/health\.ts/)
  assert.match(out, /<handoff-changed-files>/)
  assert.ok(out.trimEnd().endsWith('now add a test'))
})

test('drops the oldest turns to stay within budget and says how many', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    role: 'user' as const,
    content: `turn ${i} ${'x'.repeat(100)}`,
  }))
  const out = buildHandoffPrompt({
    fromLabel: 'Claude',
    toLabel: 'Codex',
    messages: many,
    prompt: 'continue',
    maxChars: 300,
  })
  assert.match(out, /earlier turns omitted/)
  assert.match(out, /turn 9/)
  assert.ok(!out.includes('turn 0 '))
})

test('keeps at least the latest turn even when it alone blows the budget', () => {
  const out = buildHandoffPrompt({
    fromLabel: 'Claude',
    toLabel: 'Codex',
    messages: [{ role: 'user', content: 'y'.repeat(400) }],
    prompt: 'continue',
    maxChars: 10,
  })
  assert.match(out, /yyy/)
})

test('system messages are not replayed as turns', () => {
  const out = buildHandoffPrompt({
    fromLabel: 'Claude',
    toLabel: 'Codex',
    messages: [{ role: 'system', content: 'resumed a native chat' }, ...messages],
    prompt: 'continue',
  })
  assert.ok(!out.includes('resumed a native chat'))
})

test('the transcript note names both runtimes', () => {
  assert.match(handoffSystemNote('Claude Code', 'Codex'), /Claude Code to Codex/)
})
