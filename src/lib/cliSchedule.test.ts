import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CLI_PR_INSTRUCTION,
  dailyCron,
  deriveTaskName,
  nextClockOccurrence,
  parseClockTime,
  parseCliSchedule,
  promptWithPrIntent,
  readPromptAndPrIntent,
} from './cliSchedule.ts'

/** Wednesday 21 January 2026, 10:00 local. Pinned so relative times are exact. */
const NOW = new Date(2026, 0, 21, 10, 0, 0, 0)

it('interactive drafts keep explicit choices while allowing the prompt to be filled later', () => {
  const argv = ['tomorrow', 'at', '9', '--runtime=codex', '--in=storefront']
  assert.equal(parseCliSchedule(argv, NOW).ok, false)
  const draft = parseCliSchedule(argv, NOW, { allowEmptyPrompt: true })
  assert.ok(draft.ok)
  assert.equal(draft.intent.prompt, '')
  assert.equal(draft.intent.runtimeHint, 'codex')
  assert.equal(draft.intent.workspaceHint, 'storefront')
  assert.equal(draft.intent.schedule.kind, 'once')
  assert.equal(parseCliSchedule([], NOW).ok, false)
  assert.equal(parseCliSchedule([], NOW, { allowEmptyPrompt: true }).ok, true)
  assert.equal(parseCliSchedule(['at', '25:00'], NOW, { allowEmptyPrompt: true }).ok, false)
})

/** What the shell hands the CLI: a quoted prompt is one argv element. */
function parse(argv: string[], now = NOW) {
  const result = parseCliSchedule(argv, now)
  assert.ok(result.ok, `expected a parse, got: ${result.ok ? '' : result.error}`)
  return result.intent
}

function refusal(argv: string[], now = NOW): string {
  const result = parseCliSchedule(argv, now)
  assert.ok(!result.ok, 'expected a refusal')
  return result.error
}

describe('parseClockTime', () => {
  it('reads 24-hour, 12-hour and separator variants', () => {
    assert.deepEqual(parseClockTime('16:40'), { hour: 16, minute: 40 })
    assert.deepEqual(parseClockTime('09.30'), { hour: 9, minute: 30 })
    assert.deepEqual(parseClockTime('16h40'), { hour: 16, minute: 40 })
    assert.deepEqual(parseClockTime('4:40pm'), { hour: 16, minute: 40 })
    assert.deepEqual(parseClockTime('4pm'), { hour: 16, minute: 0 })
    assert.deepEqual(parseClockTime('9'), { hour: 9, minute: 0 })
  })

  it('maps midnight and noon the way a person means them', () => {
    assert.deepEqual(parseClockTime('12am'), { hour: 0, minute: 0 })
    assert.deepEqual(parseClockTime('12pm'), { hour: 12, minute: 0 })
  })

  it('rejects out-of-range and non-times', () => {
    assert.equal(parseClockTime('25:00'), null)
    assert.equal(parseClockTime('16:70'), null)
    assert.equal(parseClockTime('13pm'), null)
    assert.equal(parseClockTime('homepage'), null)
    assert.equal(parseClockTime(''), null)
  })
})

describe('nextClockOccurrence', () => {
  it('stays today when the time is still ahead', () => {
    assert.equal(nextClockOccurrence(16, 40, NOW), new Date(2026, 0, 21, 16, 40).getTime())
  })

  it('rolls to tomorrow when the time has passed', () => {
    assert.equal(nextClockOccurrence(9, 0, NOW), new Date(2026, 0, 22, 9, 0).getTime())
  })

  it('honours an explicit day offset without rolling again', () => {
    assert.equal(nextClockOccurrence(16, 40, NOW, 1), new Date(2026, 0, 22, 16, 40).getTime())
  })
})

describe('parseCliSchedule', () => {
  it('parses the whole documented line', () => {
    const intent = parse([
      'task',
      'for',
      'claude',
      'at',
      '16:40',
      'create new homepage with contactform',
      'push',
      'and',
      'open',
      'pull',
      'request',
      'when',
      'done',
    ])

    assert.equal(intent.prompt, 'create new homepage with contactform')
    assert.equal(intent.runtimeHint, 'claude')
    assert.equal(intent.openPr, true)
    assert.deepEqual(intent.schedule, {
      kind: 'once',
      cron: '40 16 * * *',
      at: new Date(2026, 0, 21, 16, 40).getTime(),
    })
  })

  it('treats a bare time as a one-shot, not a daily schedule', () => {
    const intent = parse(['at', '16:40', 'ship the release notes'])
    assert.equal(intent.schedule.kind, 'once')
  })

  it('treats "every day at" as recurring', () => {
    const intent = parse(['every', 'day', 'at', '09:00', 'triage new issues'])
    assert.deepEqual(intent.schedule, { kind: 'recurring', cron: '0 9 * * *' })
  })

  it('builds weekday, weekly and interval crons', () => {
    assert.deepEqual(parse(['every', 'weekday', 'at', '8:30', 'x']).schedule, {
      kind: 'recurring',
      cron: '30 8 * * 1-5',
    })
    assert.deepEqual(parse(['every', 'monday', 'at', '14:30', 'x']).schedule, {
      kind: 'recurring',
      cron: '30 14 * * 1',
    })
    assert.deepEqual(parse(['every', '15', 'minutes', 'x']).schedule, {
      kind: 'recurring',
      cron: '*/15 * * * *',
    })
    assert.deepEqual(parse(['every', '2', 'hours', 'x']).schedule, {
      kind: 'recurring',
      cron: '0 */2 * * *',
    })
    assert.deepEqual(parse(['hourly', 'x']).schedule, { kind: 'recurring', cron: '0 * * * *' })
  })

  it('reads a relative one-shot', () => {
    assert.deepEqual(parse(['in', '20', 'minutes', 'run the checks']).schedule, {
      kind: 'once',
      cron: '20 10 * * *',
      at: NOW.getTime() + 20 * 60_000,
    })
  })

  it('reads "tomorrow at" as tomorrow, never today', () => {
    assert.deepEqual(parse(['tomorrow', 'at', '16:40', 'x']).schedule, {
      kind: 'once',
      cron: '40 16 * * *',
      at: new Date(2026, 0, 22, 16, 40).getTime(),
    })
  })

  it('keeps an explicit today on today, and refuses a past time', () => {
    const intent = parse(['today', 'at', '16:40', 'x'])
    assert.equal(
      intent.schedule.kind === 'once' && intent.schedule.at,
      new Date(2026, 0, 21, 16, 40).getTime(),
    )
    assert.match(refusal(['today', 'at', '9', 'x']), /already passed/)
  })

  it('refuses intervals cron cannot represent evenly', () => {
    assert.match(refusal(['every', '7', 'minutes', 'x']), /divide 60/)
    assert.match(refusal(['every', '5', 'hours', 'x']), /divide 24/)
  })

  it('rejects a missing option value without consuming the next option', () => {
    assert.match(refusal(['--runtime', '--model', 'default', 'fix the build']), /needs a value/)
    assert.match(refusal(['--runtime=', 'fix the build']), /needs a value/)
  })

  it('passes an explicit prompt literally without inferring schedule or PR intent', () => {
    const prompt = 'review every PR in the repository now'
    const intent = parse(['--prompt', prompt])
    assert.equal(intent.prompt, prompt)
    assert.equal(intent.openPr, false)
    assert.deepEqual(intent.schedule, { kind: 'now' })
    assert.equal(parse(['--prompt=--help']).prompt, '--help')
    assert.equal(
      parse(['--', 'explain', 'every', 'day', 'at', '9']).prompt,
      'explain every day at 9',
    )
    assert.match(refusal(['now', 'every', 'day', 'x']), /either "now" or a schedule/)
  })

  it('accepts a raw cron expression', () => {
    assert.deepEqual(parse(['cron', '0 9 * * 1-5', 'weekday standup notes']).schedule, {
      kind: 'recurring',
      cron: '0 9 * * 1-5',
    })
  })

  it('asks for nothing to be armed when the line says now', () => {
    assert.deepEqual(parse(['now', 'for', 'codex', 'fix the build']).schedule, { kind: 'now' })
    assert.deepEqual(parse(['for', 'codex', 'fix the build']).schedule, { kind: 'now' })
  })

  it('reads a workspace hint without swallowing a relative time', () => {
    assert.equal(parse(['in', 'openrun', 'at', '9', 'x']).workspaceHint, 'openrun')
    assert.equal(parse(['in', '20', 'minutes', 'x']).workspaceHint, '')
  })

  it('reads long options, with or without an equals sign', () => {
    const intent = parse([
      '--runtime',
      'codex',
      '--model=gpt-5',
      '--name',
      'Nightly sweep',
      '--in',
      '/repo/wt',
      'every',
      'day',
      'at',
      '3',
      'sweep',
    ])
    assert.equal(intent.runtimeHint, 'codex')
    assert.equal(intent.modelHint, 'gpt-5')
    assert.equal(intent.name, 'Nightly sweep')
    assert.equal(intent.workspaceHint, '/repo/wt')
  })

  it('leaves "with" alone when it is part of the prompt', () => {
    const intent = parse(['at', '9', 'build a homepage', 'with', 'a', 'contact', 'form'])
    assert.equal(intent.runtimeHint, '')
    assert.equal(intent.prompt, 'build a homepage with a contact form')
  })

  it('refuses a time it cannot read, naming what it wanted', () => {
    assert.match(refusal(['at', 'teatime', 'x']), /is not a time/)
    assert.match(refusal(['every', 'fortnight', 'x']), /is not a schedule/)
    assert.match(refusal(['--nope', 'x', 'y']), /Unknown option/)
  })

  it('refuses an empty prompt rather than scheduling nothing', () => {
    assert.match(refusal(['at', '16:40']), /No prompt found/)
    assert.match(refusal([]), /Nothing to schedule/)
  })
})

describe('readPromptAndPrIntent', () => {
  it('prefers a quoted prompt over the bare words around it', () => {
    const { prompt } = readPromptAndPrIntent(['task', 'do the thing', 'push'])
    assert.equal(prompt, 'do the thing')
  })

  it('falls back to the bare words when nothing was quoted', () => {
    const { prompt, openPr } = readPromptAndPrIntent(['fix', 'the', 'flaky', 'test'])
    assert.equal(prompt, 'fix flaky test')
    assert.equal(openPr, false)
  })

  it('keeps "create" in the prompt when no pull request was asked for', () => {
    const { prompt } = readPromptAndPrIntent(['create', 'new', 'homepage'])
    assert.equal(prompt, 'create new homepage')
  })

  it('sets the flag from a pull request asked for inside the quotes', () => {
    const { prompt, openPr } = readPromptAndPrIntent(['fix it and open a pull request'])
    assert.equal(prompt, 'fix it and open a pull request')
    assert.equal(openPr, true)
  })

  it('reads push, pr and pull request as the same intent', () => {
    for (const word of ['push', 'pr', 'pull-request']) {
      assert.equal(readPromptAndPrIntent(['work on it', word]).openPr, true, word)
    }
    assert.equal(readPromptAndPrIntent(['work on it', 'pull', 'request']).openPr, true)
  })
})

describe('promptWithPrIntent', () => {
  it('appends the ship instruction when the prompt does not say it', () => {
    assert.equal(
      promptWithPrIntent('build the homepage', true),
      `build the homepage\n\n${CLI_PR_INSTRUCTION}`,
    )
  })

  it('leaves a prompt that already asks for a pull request alone', () => {
    const prompt = 'build the homepage and open a pull request'
    assert.equal(promptWithPrIntent(prompt, true), prompt)
    assert.equal(promptWithPrIntent('build the homepage', false), 'build the homepage')
  })
})

describe('deriveTaskName', () => {
  it('keeps a short prompt verbatim', () => {
    assert.equal(deriveTaskName('create new homepage'), 'create new homepage')
  })

  it('truncates a long prompt on a word boundary', () => {
    const name = deriveTaskName('create a new marketing homepage with a working contact form')
    assert.ok(name.length <= 49, name)
    assert.ok(name.endsWith('…'), name)
    assert.ok(!name.includes('  '), name)
  })
})

describe('dailyCron', () => {
  it('writes the minute before the hour, as cron does', () => {
    assert.equal(dailyCron(16, 40), '40 16 * * *')
    assert.equal(dailyCron(0, 0), '0 0 * * *')
  })
})
