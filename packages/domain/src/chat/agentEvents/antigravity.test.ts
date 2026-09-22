import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractAntigravityAssistantText, parseAntigravityObject } from './antigravity.ts'
import { AssistantDeltaCoalescer, assistantTextFromEvents, parseTurnEventLine } from './index.ts'

/** Envelopes copied from a real `agy --output-format stream-json` run. */
const INIT = {
  event: 'init',
  conversation_id: 'c1',
  init: {
    model: 'gemini-3.8-flash-low',
    cwd: '/tmp',
    tools: [],
    permission_mode: 'request-review',
  },
}

function stepUpdate(step: Record<string, unknown>) {
  return { event: 'step_update', step_update: { conversation_id: 'c1', ...step } }
}

test('init and user_input carry no turn content', () => {
  assert.deepEqual(parseAntigravityObject(INIT), [])
  assert.deepEqual(
    parseAntigravityObject(stepUpdate({ step_index: 0, state: 'DONE', step_type: 'user_input' })),
    [],
  )
})

test('agent_response text becomes an assistant event', () => {
  const events = parseAntigravityObject(
    stepUpdate({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'PONG' }),
  )
  assert.deepEqual(events, [{ kind: 'assistant', payload: { text: 'PONG' } }])
})

test('an agent_response with only usage stays silent', () => {
  // agy emits a text-free step to report timing/usage; it must not become an
  // empty assistant bubble.
  const events = parseAntigravityObject(
    stepUpdate({
      step_index: 1,
      state: 'DONE',
      step_type: 'agent_response',
      duration_seconds: 1.2,
      usage: { total_tokens: 10 },
    }),
  )
  assert.deepEqual(events, [])
})

test('a tool step pairs ACTIVE with DONE on one call id', () => {
  const info = { name: 'find_by_name', parameters: { Pattern: '*.txt', SearchDirectory: '/repo' } }
  const [start] = parseAntigravityObject(
    stepUpdate({
      step_index: 2,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'find_by_name',
      tool_info: info,
    }),
  )
  const [end] = parseAntigravityObject(
    stepUpdate({
      step_index: 2,
      state: 'DONE',
      step_type: 'tool',
      tool_name: 'find_by_name',
      tool_info: info,
    }),
  )

  assert.equal(start?.kind, 'tool_start')
  assert.equal(end?.kind, 'tool_result')
  assert.equal(start?.payload.toolCallId, end?.payload.toolCallId)
  assert.equal(end?.payload.status, 'completed')
})

test('PascalCased tool parameters still yield a title and locations', () => {
  const [start] = parseAntigravityObject(
    stepUpdate({
      step_index: 3,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: { name: 'run_command', parameters: { CommandLine: 'ls -la' } },
    }),
  )
  assert.match(String(start?.payload.title), /ls -la/)

  const [edit] = parseAntigravityObject(
    stepUpdate({
      step_index: 4,
      state: 'ACTIVE',
      step_type: 'tool',
      tool_name: 'replace_file_content',
      tool_info: { name: 'replace_file_content', parameters: { TargetFile: '/repo/a.ts' } },
    }),
  )
  assert.deepEqual(edit?.payload.locations, [{ path: '/repo/a.ts' }])
})

test('a failed tool reports its error message', () => {
  const [end] = parseAntigravityObject(
    stepUpdate({
      step_index: 5,
      state: 'ERROR',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: {
        name: 'run_command',
        parameters: { CommandLine: 'find /' },
        error: { type: 'TOOL_ERROR', message: 'permission check failed' },
      },
    }),
  )
  assert.equal(end?.kind, 'tool_result')
  assert.equal(end?.payload.status, 'failed')
  assert.equal(end?.payload.content, 'permission check failed')
})

test('a successful result ends the turn without repeating the answer', () => {
  // `response` restates what the agent_response steps already streamed; putting
  // it on turn_done too renders the reply a second time.
  const events = parseAntigravityObject({
    event: 'result',
    result: { conversation_id: 'c1', status: 'SUCCESS', response: 'done' },
  })
  assert.deepEqual(events, [{ kind: 'turn_done', payload: { stopReason: 'end_turn' } }])
})

test('a chunked answer renders once, joined without blank lines', () => {
  // Regression: two prose chunks plus the full `response` on turn_done rendered
  // as "Hello \n\nworld\n\nHello world".
  const coalescer = new AssistantDeltaCoalescer()
  const rows: Array<{ kind: string; payload: string }> = []
  const collect = (events: ReturnType<typeof parseTurnEventLine>) => {
    for (const ev of events) rows.push({ kind: ev.kind, payload: JSON.stringify(ev.payload) })
  }

  const lines = [
    stepUpdate({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'Hello ' }),
    stepUpdate({ step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'world' }),
    { event: 'result', result: { status: 'SUCCESS', response: 'Hello world' } },
  ]
  for (const line of lines) {
    collect(coalescer.push(parseTurnEventLine(JSON.stringify(line), 'antigravity')))
  }
  collect(coalescer.flush())

  assert.deepEqual(
    rows.map((r) => r.kind),
    ['assistant', 'turn_done'],
  )
  assert.equal(assistantTextFromEvents(rows), 'Hello world')
})

test('a non-SUCCESS result surfaces an error before turn_done', () => {
  const events = parseAntigravityObject({
    event: 'result',
    result: { status: 'ERROR', response: '', error: 'model overloaded' },
  })
  assert.deepEqual(events, [
    { kind: 'error', payload: { text: 'model overloaded' } },
    { kind: 'turn_done', payload: {} },
  ])
})

test('the dispatcher routes antigravity to its own adapter', () => {
  // Regression: routing agy to Claude's adapter matched no `type` field, so
  // every line parsed as nothing and the run showed an empty response.
  const line = JSON.stringify(
    stepUpdate({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'hi' }),
  )
  assert.deepEqual(parseTurnEventLine(line, 'antigravity'), [
    { kind: 'assistant', payload: { text: 'hi' } },
  ])
  assert.deepEqual(parseTurnEventLine(line, 'claude'), [])
})

test('assistant text joins response steps, falling back to the result', () => {
  const stdout = [
    JSON.stringify(INIT),
    JSON.stringify(
      stepUpdate({ step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'PO' }),
    ),
    JSON.stringify(
      stepUpdate({ step_index: 2, state: 'DONE', step_type: 'agent_response', text_delta: 'NG' }),
    ),
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'PONG' } }),
  ].join('\n')
  assert.equal(extractAntigravityAssistantText(stdout), 'PONG')

  const onlyResult = [
    JSON.stringify(INIT),
    JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'from result' } }),
  ].join('\n')
  assert.equal(extractAntigravityAssistantText(onlyResult), 'from result')
})

test('non-agy stdout is declined so other extractors can try', () => {
  assert.equal(extractAntigravityAssistantText('{"type":"result","result":"claude"}'), null)
  assert.equal(extractAntigravityAssistantText('plain prose'), null)
})
