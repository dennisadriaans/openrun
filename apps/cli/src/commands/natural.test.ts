import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLocalAgent,
  parseLocalRequest,
  readInterpretation,
  requestAction,
  resolveNativeModel,
  scheduleFromText,
  splitScheduledTask,
  textFromSpan,
  type NativeCatalog,
} from './natural.ts'
import { completeNativeIntent, nativeArgs } from './native.ts'
import { readCliArgs, readCliLine } from './args.ts'
import { CLAUDE_MODELS, CODEX_MODELS } from '@openrun/domain/runtimes/models'

// Discovery often returns full display names rather than the fallback nicknames.
const catalogs: NativeCatalog[] = [
  { runtime: 'codex', models: CODEX_MODELS.map((model) => ({ ...model, shortName: model.name })) },
  { runtime: 'claude', models: CLAUDE_MODELS },
]

test('implicit tasks select the runtime, model and effort without interpretation', () => {
  const prompt = "create new file index-test.html with contents '123'"
  const request = `${prompt} sonnet low`
  for (const args of [
    readCliArgs([request]),
    readCliArgs([prompt, 'sonnet', 'low']),
    readCliLine(request),
    readCliLine(`launch ${request}`),
  ]) {
    assert.equal(args.command, 'launch')
    const result = parseLocalRequest(args.flags.rest, catalogs, 'auto')
    assert.ok(result)
    assert.equal(result.action, 'launch')
    assert.equal(result.intent.prompt, prompt)
    assert.equal(result.intent.runtimeHint, 'claude')
    assert.equal(result.intent.modelHint, 'claude-sonnet-5')
    assert.equal(result.intent.effortHint, 'low')
    assert.deepEqual(result.clarify, [])
    assert.deepEqual(
      nativeArgs({
        runtime: 'claude',
        model: result.intent.modelHint,
        effort: result.intent.effortHint!,
        prompt: result.intent.prompt,
        cwd: '/repo',
      }),
      [
        '--dangerously-skip-permissions',
        '--model',
        'claude-sonnet-5',
        '--effort',
        'low',
        '--',
        prompt,
      ],
    )
  }
})

test('task controls work at either end and with catalog model names', () => {
  for (const request of [
    'create a file sonnet LOW',
    'create a file using sonnet low',
    'sonnet low create a file',
    'create a file Claude Sonnet 5 low',
    'create a file using sonnet with medium reasoning',
  ]) {
    const result = parseLocalRequest([request], catalogs, 'auto')
    assert.equal(result?.intent.prompt, 'create a file')
    assert.equal(result?.intent.runtimeHint, 'claude')
    assert.equal(result?.intent.effortHint, request.includes('medium') ? 'medium' : 'low')
  }
  const result = parseLocalRequest(['review changes sol medium'], catalogs, 'auto')
  assert.equal(result?.intent.runtimeHint, 'codex')
  assert.equal(result?.intent.modelHint, 'gpt-5.6-sol')
  assert.equal(result?.intent.prompt, 'review changes')
})

test('runtime, model, effort and the literal task work in every order', () => {
  const prompt = "create new file test-123123.html with contents '123'"
  const orders = [
    ['claude', 'sonnet', 'low'],
    ['claude', 'low', 'sonnet'],
    ['sonnet', 'claude', 'low'],
    ['sonnet', 'low', 'claude'],
    ['low', 'claude', 'sonnet'],
    ['low', 'sonnet', 'claude'],
  ]
  for (const order of orders) {
    for (let index = 0; index <= order.length; index++) {
      const words = [...order.slice(0, index), prompt, ...order.slice(index)]
      for (const args of [readCliLine(words.join(' ')), readCliArgs(words)]) {
        const result = parseLocalRequest(args.flags.rest, catalogs, 'auto')
        assert.ok(result, words.join(' '))
        assert.equal(result.action, 'launch')
        assert.equal(result.intent.prompt, prompt)
        assert.equal(result.intent.runtimeHint, 'claude')
        assert.equal(result.intent.modelHint, 'claude-sonnet-5')
        assert.equal(result.intent.effortHint, 'low')
        assert.deepEqual(result.clarify, [])
      }
    }
  }
})

test('controls inside a task preserve literal contents and scheduled execution', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  const prompt = "create new file test-123123.html with contents 'claude low sonnet'"
  for (const request of [
    "create new file low claude sonnet test-123123.html with contents 'claude low sonnet'",
    `${prompt} using effort low model sonnet runtime claude`,
    `low ${prompt} using claude model sonnet`,
  ]) {
    for (const timing of ['', ' in 10 minutes']) {
      const result = parseLocalRequest([request + timing], catalogs, 'auto', now)
      assert.ok(result, request + timing)
      assert.equal(result.intent.prompt, prompt)
      assert.equal(result.intent.modelHint, 'claude-sonnet-5')
      assert.equal(result.intent.effortHint, 'low')
      assert.equal(result.action, timing ? 'schedule' : 'launch')
    }
  }
})

test('conflicting controls require interpretation instead of silently choosing an agent', () => {
  for (const request of [
    'create a file claude sonnet codex low',
    'low create a file claude sonnet high',
  ]) {
    assert.equal(parseLocalAgent([request], catalogs).selection, undefined, request)
    assert.equal(parseLocalRequest([request], catalogs, 'auto'), undefined, request)
  }
})

test('home requests with an explicit execution delay schedule the original task directly', () => {
  const now = new Date(2026, 8, 22, 14, 0, 55)
  const prompt = "create new file test-html with contents '123'"
  for (const directive of [
    'do it in 10 seconds',
    'run it after 10 seconds',
    'schedule this in 10 seconds',
  ]) {
    for (const suffix of ['sonnet low', 'sonnet low.']) {
      const request = `${prompt} ${directive} ${suffix}`
      const args = readCliLine(request)
      assert.equal(args.command, 'launch')
      const result = parseLocalRequest(args.flags.rest, catalogs, 'auto', now)
      assert.ok(result, request)
      assert.equal(result.action, 'schedule')
      assert.equal(result.intent.prompt, prompt)
      assert.equal(result.intent.runtimeHint, 'claude')
      assert.equal(result.intent.modelHint, 'claude-sonnet-5')
      assert.equal(result.intent.effortHint, 'low')
      assert.deepEqual(result.intent.schedule, {
        kind: 'once',
        cron: '1 14 * * *',
        at: now.getTime() + 10_000,
      })
      assert.deepEqual(result.clarify, [])
    }
  }
})

test('execution instructions inside quoted task contents remain literal', () => {
  const prompt = 'write a file containing "do it in 10 seconds"'
  const result = parseLocalRequest([`${prompt} sonnet low`], catalogs, 'auto')
  assert.equal(result?.action, 'launch')
  assert.equal(result?.intent.prompt, prompt)
  assert.deepEqual(result?.intent.schedule, { kind: 'now' })
  const quoted = parseLocalRequest(
    ['"write a file saying do it in 10 seconds" sonnet low'],
    catalogs,
    'auto',
  )
  assert.equal(quoted?.action, 'launch')
  assert.equal(quoted?.intent.prompt, 'write a file saying do it in 10 seconds')
  assert.deepEqual(quoted?.intent.schedule, { kind: 'now' })
  for (const request of [
    'create a file do it in 0 seconds sonnet low',
    'create a file do it next weekend sonnet low',
    'create a file do it in 10 seconds and review the changes sonnet low',
  ])
    assert.equal(parseLocalRequest([request], catalogs, 'auto'), undefined, request)
})

test('a trailing runtime and model schedule a task without an explicit effort', () => {
  const now = new Date(2026, 8, 22, 14, 0, 55)
  const prompt = 'create new file "test-html"'
  const request = `${prompt} in 10 seconds claude sonnet`
  for (const args of [readCliLine(request), readCliArgs([request])]) {
    for (const mode of ['auto', 'schedule'] as const) {
      const result = parseLocalRequest(args.flags.rest, catalogs, mode, now)
      assert.ok(result)
      assert.equal(result.action, 'schedule')
      assert.equal(result.intent.prompt, prompt)
      assert.equal(result.intent.runtimeHint, 'claude')
      assert.equal(result.intent.modelHint, 'claude-sonnet-5')
      assert.equal(result.intent.effortHint, '')
      assert.deepEqual(result.intent.schedule, {
        kind: 'once',
        cron: '1 14 * * *',
        at: now.getTime() + 10_000,
      })
      assert.deepEqual(result.clarify, [])
    }
    assert.equal(parseLocalAgent(args.flags.rest, catalogs).selection?.hasEffort, false)
  }
})

test('local tasks preserve literal content and do not consume model mentions inside it', () => {
  const prompt = 'write a file with contents "sonnet low" and keep  two spaces'
  const result = parseLocalRequest([`${prompt} sol medium`], catalogs, 'auto')
  assert.equal(result?.intent.prompt, prompt)
  assert.equal(result?.intent.modelHint, 'gpt-5.6-sol')
  assert.equal(parseLocalAgent(['write a sonnet'], catalogs).selection, undefined)
  assert.equal(parseLocalAgent(['write "sonnet low"'], catalogs).selection, undefined)
  assert.equal(parseLocalAgent(['write "claude sonnet"'], catalogs).selection, undefined)
  assert.equal(
    parseLocalRequest(['"write a sonnet" sol medium'], catalogs, 'auto')?.intent.prompt,
    'write a sonnet',
  )
})

test('unclear timing, management requests and unknown controls still require interpretation', () => {
  for (const request of [
    'create a file next weekend sonnet low',
    'show recent runs sonnet low',
    'create a file unknown-model low',
    'create a file sonnet unknown-effort',
  ])
    assert.equal(parseLocalRequest([request], catalogs, 'auto'), undefined, request)
  const result = parseLocalRequest(['create a file haiku low'], catalogs, 'auto')
  assert.equal(result?.intent.modelHint, 'claude-haiku-4-5')
  assert.equal(
    result?.intent.effortHint,
    'low',
    'keep unsupported levels for the existing effort validator',
  )
})

test('an ordinary delay before or after the task selects scheduling without an action question', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  const prompt = "create file test.html with contents '123'"
  for (const request of [
    `${prompt} in 10 minutes sonnet low`,
    `${prompt} in 10 minuts sonnet low.`,
    `in 10 minutes ${prompt} sonnet low`,
    `in 10 minuts "${prompt}" sonnet low`,
    `"${prompt}" in 10 minutes sonnet low`,
  ]) {
    for (const mode of ['auto', 'schedule'] as const) {
      const result = parseLocalRequest([request], catalogs, mode, now)
      assert.ok(result, request)
      assert.equal(result.action, 'schedule')
      assert.equal(result.intent.prompt, prompt)
      assert.equal(result.intent.runtimeHint, 'claude')
      assert.equal(result.intent.modelHint, 'claude-sonnet-5')
      assert.equal(result.intent.effortHint, 'low')
      assert.equal(result.intent.workspaceHint, '')
      assert.deepEqual(result.intent.schedule, {
        kind: 'once',
        cron: '10 14 * * *',
        at: now.getTime() + 600_000,
      })
      assert.deepEqual(result.clarify, [])
    }
  }
  assert.equal(
    parseLocalRequest(['create a file tomorrow sonnet low'], catalogs, 'auto', now)?.action,
    'schedule',
  )
})

test('a quoted task with Sonnet and low effort opens the agent immediately', () => {
  const result = parseLocalRequest(['"create file test.html" sonnet low.'], catalogs, 'auto')
  assert.ok(result)
  assert.equal(result.action, 'launch')
  assert.equal(result.intent.prompt, 'create file test.html')
  assert.equal(result.intent.runtimeHint, 'claude')
  assert.equal(result.intent.modelHint, 'claude-sonnet-5')
  assert.equal(result.intent.effortHint, 'low')
  assert.deepEqual(result.intent.schedule, { kind: 'now' })
  assert.deepEqual(result.clarify, [])
})

test('action inference ignores quoted timing and asks only about conflicting execution times', () => {
  assert.equal(requestAction('create file test.html sonnet low'), 'launch')
  assert.equal(requestAction('create file test.html in 10 minuts sonnet low'), 'schedule')
  assert.equal(requestAction('create file test.html next weekend sonnet low'), 'schedule')
  assert.equal(requestAction('create file test.html 10 minutes from now sonnet low'), 'schedule')
  assert.equal(requestAction('update every file in a directory sonnet low'), 'launch')
  assert.equal(requestAction('create files in 10 directories sonnet low'), 'launch')
  assert.equal(requestAction('check the project every weekday at 9 sonnet low'), 'schedule')
  assert.equal(requestAction('create file with contents "in 10 minutes" sonnet low'), 'launch')
  assert.equal(requestAction('"create file with contents in 10 minutes" sonnet low'), 'launch')
  assert.equal(requestAction('create file now or in 10 minutes sonnet low'), undefined)
})

test('low-confidence hosted actions follow the requested timing instead of asking launch or schedule', () => {
  const prompt = 'create file test.html'
  for (const timing of ['', 'in 10 minuts']) {
    const text = `${prompt} ${timing} sonnet low`
    for (const action of ['launch', 'schedule']) {
      const result = readInterpretation(
        {
          version: 1,
          action,
          runtime: 'claude',
          model: 'claude-sonnet-5',
          effort: 'low',
          prompt: { start: 0, end: prompt.length },
          schedule: timing
            ? { start: prompt.length + 1, end: prompt.length + 1 + timing.length }
            : null,
          openPr: false,
          clarify: ['action'],
        },
        text,
        'auto',
      )
      assert.equal(result.action, timing ? 'schedule' : 'launch')
      assert.equal(result.intent.schedule.kind, timing ? 'once' : 'now')
      assert.deepEqual(result.clarify, [])
    }
  }
})

test('an unparsed time asks for the time, without asking whether to schedule', () => {
  const prompt = 'create file test.html'
  const text = `${prompt} next weekend sonnet low`
  const result = readInterpretation(
    {
      version: 1,
      action: 'launch',
      runtime: 'claude',
      model: 'claude-sonnet-5',
      effort: 'low',
      prompt: { start: 0, end: prompt.length },
      schedule: { start: prompt.length + 1, end: prompt.length + 1 + 'next weekend'.length },
      openPr: false,
      clarify: ['action'],
    },
    text,
    'auto',
  )
  assert.equal(result.action, 'schedule')
  assert.deepEqual(result.clarify, ['schedule'])
})

test('the complete Sol schedule resolves locally with exact timing, prompt and effort', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  const result = parseLocalRequest(
    ['in', '1', 'minutes', 'new file index3.html', 'using', 'sol', 'medium'],
    catalogs,
    'schedule',
    now,
  )
  assert.ok(result)
  assert.equal(result.action, 'schedule')
  assert.equal(result.intent.runtimeHint, 'codex')
  assert.equal(result.intent.modelHint, 'gpt-5.6-sol')
  assert.equal(result.intent.effortHint, 'medium')
  assert.equal(result.intent.prompt, 'new file index3.html')
  assert.equal(result.intent.schedule.kind, 'once')
  if (result.intent.schedule.kind === 'once')
    assert.equal(result.intent.schedule.at, now.getTime() + 60_000)
  assert.deepEqual(result.clarify, [])
})

test('a ten-second schedule keeps Sol and medium without requesting clarification', () => {
  const now = new Date(2026, 8, 22, 14, 0, 55)
  for (const words of [
    ['in', '10', 'seconds', 'new file index3.html', 'using', 'sol', 'medium'],
    ['in 10 seconds "new file index3.html" using sol medium'],
  ]) {
    const result = parseLocalRequest(words, catalogs, 'schedule', now)
    assert.ok(result)
    assert.equal(result.action, 'schedule')
    assert.equal(result.intent.prompt, 'new file index3.html')
    assert.equal(result.intent.workspaceHint, '')
    assert.equal(result.intent.runtimeHint, 'codex')
    assert.equal(result.intent.modelHint, 'gpt-5.6-sol')
    assert.equal(result.intent.effortHint, 'medium')
    assert.deepEqual(result.intent.schedule, {
      kind: 'once',
      cron: '1 14 * * *',
      at: now.getTime() + 10_000,
    })
    assert.deepEqual(result.clarify, [])
  }
})

test('known model and effort survive a time that still needs interpretation', () => {
  const words = ['next', 'weekend', 'new file index3.html', 'using', 'sol', 'medium']
  assert.equal(parseLocalRequest(words, catalogs, 'schedule'), undefined)
  const parsed = parseLocalAgent(words, catalogs)
  assert.equal(parsed.selection?.runtime, 'codex')
  assert.equal(parsed.selection?.model, 'gpt-5.6-sol')
  assert.equal(parsed.selection?.effort, 'medium')
  assert.deepEqual(parsed.words, ['next', 'weekend', 'new file index3.html'])
})

test('model families determine the runtime and consume only adjacent effort controls', () => {
  for (const [nickname, runtime, slug] of [
    ['Sol', 'codex', 'gpt-5.6-sol'],
    ['Terra', 'codex', 'gpt-5.6-terra'],
    ['Luna', 'codex', 'gpt-5.6-luna'],
    ['Sonnet', 'claude', 'claude-sonnet-5'],
    ['Opus', 'claude', 'claude-opus-5'],
  ]) {
    const result = parseLocalRequest(
      ['in', '1', 'minute', 'new file index3.html', 'using', nickname!, 'MEDIUM'],
      catalogs,
      'schedule',
    )
    assert.equal(result?.intent.runtimeHint, runtime)
    assert.equal(result?.intent.modelHint, slug)
    assert.equal(result?.intent.effortHint, 'medium')
    assert.equal(result?.intent.prompt, 'new file index3.html')
  }
  assert.equal(resolveNativeModel('Sonnet 4.6', CLAUDE_MODELS)?.slug, 'claude-sonnet-4-6')
})

test('quoted task instructions stay intact while Home input supports the same syntax', () => {
  const prompt = 'write about tomorrow at 9 using sonnet medium in the title'
  for (const words of [
    ['in', '1', 'minutes', prompt, 'using', 'sol', 'medium'],
    [`in 1 minutes "${prompt}" using sol medium`],
  ]) {
    const result = parseLocalRequest(words, catalogs, 'schedule')
    assert.equal(result?.intent.prompt, prompt)
    assert.equal(result?.intent.modelHint, 'gpt-5.6-sol')
    assert.equal(result?.intent.effortHint, 'medium')
    assert.deepEqual(result?.clarify, [])
  }
})

test('model-only launches resolve locally; unknown models and freeform requests use interpretation', () => {
  const result = parseLocalRequest(['sol', 'medium'], catalogs, 'auto')
  assert.equal(result?.action, 'launch')
  assert.equal(result?.intent.runtimeHint, 'codex')
  assert.equal(result?.intent.modelHint, 'gpt-5.6-sol')
  assert.equal(result?.intent.effortHint, 'medium')
  assert.equal(result?.intent.prompt, '')
  assert.equal(
    parseLocalRequest(
      ['in', '1', 'minute', 'new file index3.html', 'using', 'unknown-model'],
      catalogs,
      'schedule',
    ),
    undefined,
  )
  const scheduled = parseLocalRequest(
    ['sol', 'medium', 'in', '1', 'minute', 'new file index3.html'],
    catalogs,
    'auto',
  )
  assert.equal(scheduled?.action, 'schedule')
  assert.equal(scheduled?.intent.prompt, 'new file index3.html')
  assert.equal(scheduled?.intent.modelHint, 'gpt-5.6-sol')
})

test('hosted interpretation preserves the exact quoted task and resolves time locally', () => {
  const prompt =
    'analyse all open changes, review, fix, then commit conventionally and open pull request'
  const text = `in 10 minutes '${prompt}' use Sol medium`
  const result = readInterpretation(
    {
      version: 1,
      action: 'schedule',
      runtime: 'codex',
      model: 'gpt-5.6-sol',
      effort: 'medium',
      prompt: { start: text.indexOf("'"), end: text.lastIndexOf("'") + 1 },
      schedule: { start: 0, end: 'in 10 minutes'.length },
      openPr: true,
      clarify: [],
    },
    text,
    'schedule',
  )
  assert.equal(result.intent.prompt, prompt)
  assert.equal(result.intent.effortHint, 'medium')
  assert.equal(result.intent.openPr, true)
  assert.equal(result.intent.schedule.kind, 'once')
  assert.deepEqual(result.clarify, [])
})

test('a scheduling word inside a literal task does not become a schedule', () => {
  const text = 'fix the schedule page'
  const result = readInterpretation(
    {
      version: 1,
      action: 'launch',
      runtime: 'claude',
      model: '',
      effort: '',
      prompt: { start: 0, end: text.length },
      schedule: null,
      openPr: false,
      clarify: [],
    },
    text,
    'auto',
  )
  assert.equal(result.action, 'launch')
  assert.deepEqual(result.intent.schedule, { kind: 'now' })
  assert.equal(result.intent.prompt, text)
})

test('untrusted offsets and non-schedule text cannot silently create a run', () => {
  assert.throws(() => textFromSpan('task', { start: -1, end: 4 }), /boundaries/)
  assert.throws(() => textFromSpan('task', { start: 0, end: 50 }), /boundaries/)
  assert.throws(() => scheduleFromText('in the current project'), /Use a time/)
  assert.throws(() => scheduleFromText('in 10 minutes delete the project'), /Use a time/)
  assert.throws(() => readInterpretation({ version: 2 }, 'task', 'auto'), /invalid result/)
})

test('relative delays and weekday schedules use the existing local clock rules', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  for (const text of [
    'in 10 seconds',
    'after 10 seconds',
    '10 secs from now',
    'at 10 seconds from now',
    'in 10 seconds from now',
  ]) {
    assert.deepEqual(scheduleFromText(text, now), {
      kind: 'once',
      cron: '0 14 * * *',
      at: now.getTime() + 10_000,
    })
  }
  const delayed = scheduleFromText('after 10 minutes', now)
  assert.equal(delayed.kind, 'once')
  if (delayed.kind === 'once') assert.equal(delayed.at, now.getTime() + 600_000)
  assert.deepEqual(scheduleFromText('every weekday at 9', now), {
    kind: 'recurring',
    cron: '0 9 * * 1-5',
  })
})

test('native argv keeps shell syntax literal and resumes the exact session', () => {
  const prompt = '--help; $(touch /tmp/unwanted) `command`'
  assert.deepEqual(
    nativeArgs({ runtime: 'codex', model: 'gpt-5.6-sol', effort: 'medium', prompt, cwd: '/repo' }),
    ['--yolo', '--model', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="medium"', '--', prompt],
  )
  assert.deepEqual(
    nativeArgs({
      runtime: 'claude',
      sessionId: 'saved-session',
      model: '',
      effort: 'high',
      prompt: '',
      cwd: '/repo',
    }),
    ['--resume', 'saved-session', '--dangerously-skip-permissions', '--effort', 'high'],
  )
})

test('native resume uses CLI effort values and does not repeat prompt-injected effort', () => {
  const input = {
    runtime: 'claude' as const,
    model: 'claude-opus-5',
    prompt: '',
    cwd: '/repo',
    sessionId: 'saved-session',
  }
  assert.deepEqual(nativeArgs({ ...input, effort: 'ultracode' }), [
    '--resume',
    'saved-session',
    '--dangerously-skip-permissions',
    '--model',
    'claude-opus-5',
    '--effort',
    'xhigh',
  ])
  assert.deepEqual(nativeArgs({ ...input, effort: 'ultrathink' }), [
    '--resume',
    'saved-session',
    '--dangerously-skip-permissions',
    '--model',
    'claude-opus-5',
  ])
})

test('a lone model after a timed task selects it without interpretation', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  for (const model of ['heiku', 'haiku', 'Haiku']) {
    const result = parseLocalRequest(
      [`create new task foo.html contents "test" in 10 seconds ${model}`],
      catalogs,
      'auto',
      now,
    )
    assert.equal(result?.action, 'schedule', model)
    assert.equal(result.intent.prompt, 'create new task foo.html contents "test"')
    assert.equal(result.intent.runtimeHint, 'claude')
    assert.equal(result.intent.modelHint, 'claude-haiku-4-5')
    assert.equal(result.scheduleText, 'in 10 seconds')
    assert.deepEqual(result.clarify, [])
  }
  for (const request of ['write a haiku', 'explain haiku', 'create a poem about haiku'])
    assert.equal(parseLocalAgent([request], catalogs).selection, undefined, request)
})

test('an interpreted task splits its stated time locally, even without a leading verb', () => {
  const now = new Date(2026, 8, 22, 14, 0)
  const split = splitScheduledTask('foo.html contents "test" in 10 seconds', now)
  assert.equal(split?.prompt, 'foo.html contents "test"')
  assert.equal(split.scheduleText, 'in 10 seconds')
  assert.equal(split.schedule.kind, 'once')
  assert.equal(splitScheduledTask('in 10 minutes review the diff', now)?.prompt, 'review the diff')
  assert.equal(splitScheduledTask('foo.html contents "test"', now), undefined)
})

test('known values are used without asking, so the request submits on the first Enter', async () => {
  const blank = parseLocalRequest(['create a file sonnet low'], catalogs, 'auto')!
  const ui = {
    interactive: true,
    select: async (message: string) => assert.fail(`asked: ${message}`),
    text: async (message: string) => assert.fail(`asked: ${message}`),
  }
  const result = await completeNativeIntent(
    {
      interpreted: {
        action: 'schedule',
        intent: { ...blank.intent, prompt: 'create foo.html', schedule: { kind: 'now' } },
        // Ambiguous spans mark both fields even when each value is usable.
        clarify: ['prompt', 'schedule', 'effort'],
        scheduleText: 'in 10 minutes',
      },
      available: catalogs,
      saved: undefined,
      explicit: {},
      hasExplicitEffort: true,
    },
    ui,
  )
  assert.equal(result.action, 'schedule')
  assert.equal(result.intent.prompt, 'create foo.html')
  assert.equal(result.intent.schedule.kind, 'once')
  assert.equal(result.intent.modelHint, 'claude-sonnet-5')
  assert.equal(result.intent.effortHint, 'low')

  const asked: string[] = []
  await completeNativeIntent(
    {
      interpreted: {
        action: 'schedule',
        intent: { ...blank.intent, prompt: 'create foo.html', schedule: { kind: 'now' } },
        clarify: ['schedule'],
        scheduleText: 'whenever',
      },
      available: catalogs,
      saved: undefined,
      explicit: {},
      hasExplicitEffort: true,
    },
    {
      ...ui,
      text: async (message: string) => {
        asked.push(message)
        return 'in 10 minutes'
      },
    },
  )
  assert.deepEqual(asked, ['When should it run?'], 'an unreadable time is still asked for')
})
