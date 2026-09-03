import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assistantTextFromEvents,
  ensureMachineReadableArgs,
  hasEventAdapter,
  parseTurnEventLine,
} from './index.ts'

function event(kind: string, payload: unknown): { kind: string; payload: string } {
  return { kind, payload: JSON.stringify(payload) }
}

describe('hasEventAdapter', () => {
  it('is true only for the CLIs whose stdout is JSONL we can map', () => {
    assert.equal(hasEventAdapter('claude'), true)
    assert.equal(hasEventAdapter('codex'), true)
    assert.equal(hasEventAdapter('grok'), true)
    assert.equal(hasEventAdapter('gemini'), false)
    assert.equal(hasEventAdapter('generic'), false)
  })
})

describe('ensureMachineReadableArgs: Claude', () => {
  it('asks for stream-json with partial thinking deltas and verbose', () => {
    const args = ensureMachineReadableArgs(['-p', '{prompt}'], 'claude')
    assert.deepEqual(args, [
      '-p',
      '--output-format',
      'stream-json',
      '{prompt}',
      '--verbose',
      '--include-partial-messages',
    ])
  })

  it('upgrades the legacy text default in place', () => {
    const args = ensureMachineReadableArgs(['-p', '--output-format', 'text'], 'claude')
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json')
  })

  it('leaves a format the user chose alone and does not double a flag', () => {
    const args = ensureMachineReadableArgs(
      ['-p', '--output-format', 'json', '--verbose', '--include-partial-messages'],
      'claude',
    )
    assert.deepEqual(args, [
      '-p',
      '--output-format',
      'json',
      '--verbose',
      '--include-partial-messages',
    ])
  })

  it('puts the format first when there is no -p to insert after', () => {
    assert.deepEqual(ensureMachineReadableArgs([], 'claude'), [
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
    ])
  })
})

describe('ensureMachineReadableArgs: Antigravity', () => {
  it('asks for stream-json without the Claude-only flags agy rejects', () => {
    const args = ensureMachineReadableArgs(['-p', '{prompt}'], 'antigravity')
    assert.deepEqual(args, ['--output-format', 'stream-json', '-p', '{prompt}'])
    assert.ok(!args.includes('--verbose'))
    assert.ok(!args.includes('--include-partial-messages'))
  })

  it('keeps the format pair ahead of -p, which consumes the prompt token', () => {
    const args = ensureMachineReadableArgs(
      ['--dangerously-skip-permissions', '-p', 'hi'],
      'antigravity',
    )
    assert.ok(args.indexOf('--output-format') < args.indexOf('-p'))
    assert.equal(args[args.length - 1], 'hi')
  })

  it('upgrades the legacy text default in place without appending flags', () => {
    assert.deepEqual(
      ensureMachineReadableArgs(['--output-format', 'text', '-p', 'hi'], 'antigravity'),
      ['--output-format', 'stream-json', '-p', 'hi'],
    )
  })
})

describe('ensureMachineReadableArgs: Codex and Grok', () => {
  it('puts --json straight after codex exec', () => {
    assert.deepEqual(ensureMachineReadableArgs(['exec', '{prompt}'], 'codex'), [
      'exec',
      '--json',
      '{prompt}',
    ])
  })

  it('leaves a codex command that already asks for json alone', () => {
    const args = ['exec', '--json', '{prompt}']
    assert.equal(ensureMachineReadableArgs(args, 'codex'), args)
  })

  it('falls back to leading --json when there is no exec subcommand', () => {
    assert.deepEqual(ensureMachineReadableArgs(['{prompt}'], 'codex'), ['--json', '{prompt}'])
  })

  it('asks Grok for streaming-json, replacing plain or text', () => {
    assert.deepEqual(ensureMachineReadableArgs(['{prompt}'], 'grok'), [
      '{prompt}',
      '--output-format',
      'streaming-json',
    ])
    assert.deepEqual(ensureMachineReadableArgs(['--output-format', 'plain'], 'grok'), [
      '--output-format',
      'streaming-json',
    ])
  })

  it('leaves a runtime with no adapter untouched', () => {
    const args = ['--yolo', '{prompt}']
    assert.equal(ensureMachineReadableArgs(args, 'gemini'), args)
  })
})

describe('parseTurnEventLine', () => {
  it('dispatches a Claude envelope to the Claude adapter', () => {
    const events = parseTurnEventLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      }),
      'claude',
    )
    assert.equal(events[0]?.kind, 'assistant')
  })

  it('dispatches a Codex envelope to the Codex adapter', () => {
    const events = parseTurnEventLine(
      JSON.stringify({
        type: 'item.completed',
        item: { item_type: 'reasoning', text: 'weighing' },
      }),
      'codex',
    )
    assert.equal(events[0]?.kind, 'thought')
  })

  it('surfaces a non-JSON line as raw rather than dropping it', () => {
    assert.deepEqual(parseTurnEventLine('npm warn deprecated', 'claude'), [
      { kind: 'raw', payload: { text: 'npm warn deprecated' } },
    ])
    assert.deepEqual(parseTurnEventLine('{ truncated', 'claude'), [
      { kind: 'raw', payload: { text: '{ truncated' } },
    ])
  })

  it('reads Grok prose as assistant text, not as a raw pill per line', () => {
    const events = parseTurnEventLine('Here is the answer.', 'grok')
    assert.equal(events[0]?.kind, 'assistant')
  })

  it('has nothing to say about a blank line or a runtime with no adapter', () => {
    assert.deepEqual(parseTurnEventLine('   ', 'claude'), [])
    assert.deepEqual(parseTurnEventLine('{"type":"anything"}', 'gemini'), [])
  })
})

describe('assistantTextFromEvents', () => {
  it('joins the agent’s prose in order', () => {
    const text = assistantTextFromEvents([
      event('assistant', { text: 'First.' }),
      event('tool_start', { name: 'Bash' }),
      event('assistant', { text: 'Second.' }),
    ])
    assert.equal(text, 'First.\n\nSecond.')
  })

  it('drops the duplicate a legacy row left when result was also an assistant event', () => {
    const text = assistantTextFromEvents([
      event('assistant', { text: 'Done.' }),
      event('assistant', { text: 'Done.' }),
    ])
    assert.equal(text, 'Done.')
  })

  it('appends a closing result that says something new', () => {
    const text = assistantTextFromEvents([
      event('assistant', { text: 'Working.' }),
      event('turn_done', { result: 'All checks pass.' }),
    ])
    assert.equal(text, 'Working.\n\nAll checks pass.')
  })

  it('falls back to the result when the turn produced no prose', () => {
    assert.equal(
      assistantTextFromEvents([event('turn_done', { result: 'Nothing to do.' })]),
      'Nothing to do.',
    )
  })

  it('skips a row whose payload will not parse', () => {
    assert.equal(
      assistantTextFromEvents([
        { kind: 'assistant', payload: '{' },
        event('assistant', { text: 'ok' }),
      ]),
      'ok',
    )
  })
})
