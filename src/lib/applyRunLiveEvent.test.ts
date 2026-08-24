import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyRunLiveEvent,
  applyRunLiveEventToRunRow,
  type ConversationCacheSlice,
} from './applyRunLiveEvent.ts'
import type { CheckResultFrame } from './runLive.ts'

function cache(status: string, overrides: Partial<ConversationCacheSlice> = {}) {
  return {
    run: { id: 'run_1', status, stdout: '', stderr: '', exitCode: null },
    messages: [
      {
        id: 'msg_1',
        stdout: '',
        stderr: '',
        status: status === 'running' ? 'running' : 'cancelled',
        exitCode: null,
        content: '',
        events: [],
      },
    ],
    ...overrides,
  } satisfies ConversationCacheSlice
}

function turnEvent(id: string, messageId = 'msg_1') {
  return {
    type: 'turn_event' as const,
    id,
    messageId,
    runId: 'run_1',
    seq: 1,
    kind: 'assistant' as const,
    payload: { text: 'hello' },
    createdAt: 1,
  }
}

function checkResult(overrides: Partial<CheckResultFrame> = {}): CheckResultFrame {
  return {
    id: 'chk_1',
    runId: 'run_1',
    messageId: 'msg_1',
    attempt: 0,
    checkId: 'tests',
    name: 'tests',
    command: 'pnpm test',
    outcome: 'pass',
    exitCode: 0,
    output: 'ok',
    durationMs: 12,
    startedAt: 1,
    finishedAt: 2,
    ...overrides,
  }
}

describe('applyRunLiveEvent', () => {
  it('ignores the frames that carry no state', () => {
    assert.equal(applyRunLiveEvent(cache('running'), { type: 'ping' }).action, 'ignore')
    assert.equal(
      applyRunLiveEvent(cache('running'), { type: 'hello', runId: 'run_1', status: 'running' })
        .action,
      'ignore',
    )
  })

  it('patches status and canFollowUp without refetching the transcript', () => {
    const result = applyRunLiveEvent(cache('running', { canFollowUp: false }), {
      type: 'status',
      status: 'success',
      exitCode: 0,
      canFollowUp: true,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.run.status, 'success')
    assert.equal(result.data.run.exitCode, 0)
    assert.equal(result.data.canFollowUp, true)
  })

  it('drops late output from a run the user cancelled', () => {
    const data = cache('cancelled')
    assert.equal(applyRunLiveEvent(data, turnEvent('tev_1')).action, 'ignore')
    assert.equal(
      applyRunLiveEvent(data, {
        type: 'log',
        stream: 'stdout',
        chunk: 'nope',
        messageId: 'msg_1',
      }).action,
      'ignore',
    )
  })
})

describe('turn_event', () => {
  it('appends the row to the message it belongs to', () => {
    const result = applyRunLiveEvent(cache('running'), turnEvent('tev_1'))
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    const [row] = result.data.messages[0]!.events
    assert.equal(row?.id, 'tev_1')
    assert.deepEqual(JSON.parse(String(row?.payload)), { text: 'hello' })
  })

  it('ignores a redelivered frame instead of duplicating the row', () => {
    const first = applyRunLiveEvent(cache('running'), turnEvent('tev_1'))
    assert.equal(first.action, 'patch')
    if (first.action !== 'patch') return
    assert.equal(applyRunLiveEvent(first.data, turnEvent('tev_1')).action, 'ignore')
  })

  it('refetches when the message is not in the cache yet', () => {
    assert.equal(applyRunLiveEvent(cache('running'), turnEvent('tev_1', 'msg_9')).action, 'refetch')
  })
})

describe('log', () => {
  it('appends to the run and to the message that produced it', () => {
    const result = applyRunLiveEvent(cache('running'), {
      type: 'log',
      stream: 'stdout',
      chunk: 'building…',
      messageId: 'msg_1',
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.run.stdout, 'building…')
    assert.equal(result.data.messages[0]?.stdout, 'building…')
  })

  it('keeps stderr separate from stdout', () => {
    const result = applyRunLiveEvent(cache('running'), {
      type: 'log',
      stream: 'stderr',
      chunk: 'warn',
      messageId: 'msg_1',
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.run.stderr, 'warn')
    assert.equal(result.data.run.stdout, '')
  })
})

describe('turn_started', () => {
  it('seeds the user prompt and a running assistant turn, and closes the composer', () => {
    const result = applyRunLiveEvent(cache('success', { canFollowUp: true }), {
      type: 'turn_started',
      userMessageId: 'msg_2',
      assistantMessageId: 'msg_3',
      prompt: 'try again',
      createdAt: 100,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.run.status, 'running')
    assert.equal(result.data.canFollowUp, false)

    const [, user, assistant] = result.data.messages
    assert.equal(user?.content, 'try again')
    assert.equal(user?.status, 'success')
    assert.equal(assistant?.status, 'running')
    assert.ok((assistant?.createdAt ?? 0) > (user?.createdAt ?? 0))
  })

  it('ignores a turn it has already seeded', () => {
    const data = cache('running')
    const result = applyRunLiveEvent(data, {
      type: 'turn_started',
      userMessageId: 'msg_0',
      assistantMessageId: 'msg_1',
      prompt: 'again',
      createdAt: 100,
    })
    assert.equal(result.action, 'ignore')
  })
})

describe('turn_finished', () => {
  const frame = {
    type: 'turn_finished' as const,
    messageId: 'msg_1',
    status: 'success' as const,
    exitCode: 0,
    content: 'Done.',
    diffSummary: [{ path: 'a.ts' }],
    finishedAt: 500,
  }

  it('settles the turn so the working indicator can go, before the run does', () => {
    const result = applyRunLiveEvent(cache('running'), frame)
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    const message = result.data.messages[0]!
    assert.equal(message.status, 'success')
    assert.equal(message.exitCode, 0)
    assert.equal(message.content, 'Done.')
    assert.deepEqual(message.diffSummary, [{ path: 'a.ts' }])
    assert.equal(result.data.run.status, 'running')
  })

  it('keeps the streamed prose when the turn finished with none of its own', () => {
    const data = cache('running')
    data.messages[0]!.content = 'streamed so far'
    const result = applyRunLiveEvent(data, { ...frame, content: '' })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.messages[0]?.content, 'streamed so far')
  })

  it('ignores a second frame for a turn that already settled', () => {
    const first = applyRunLiveEvent(cache('running'), frame)
    assert.equal(first.action, 'patch')
    if (first.action !== 'patch') return
    assert.equal(applyRunLiveEvent(first.data, frame).action, 'ignore')
  })

  it('refetches when the turn is not in the cache', () => {
    assert.equal(
      applyRunLiveEvent(cache('running'), { ...frame, messageId: 'msg_9' }).action,
      'refetch',
    )
  })
})

describe('checks', () => {
  it('shows a check as running before it settles, then replaces it', () => {
    const started = applyRunLiveEvent(cache('running'), {
      type: 'check_started',
      id: 'chk_1',
      runId: 'run_1',
      messageId: 'msg_1',
      attempt: 0,
      checkId: 'tests',
      name: 'tests',
      command: 'pnpm test',
      startedAt: 1,
    })
    assert.equal(started.action, 'patch')
    if (started.action !== 'patch') return
    assert.equal(started.data.checkResults?.[0]?.outcome, 'running')

    const finished = applyRunLiveEvent(started.data, {
      type: 'check_finished',
      result: checkResult(),
    })
    assert.equal(finished.action, 'patch')
    if (finished.action !== 'patch') return
    assert.equal(finished.data.checkResults?.length, 1)
    assert.equal(finished.data.checkResults?.[0]?.outcome, 'pass')
  })

  it('replaces a previous pass rather than doubling it when a check re-runs', () => {
    const data = cache('running', { checkResults: [checkResult({ id: 'chk_old' })] })
    const result = applyRunLiveEvent(data, {
      type: 'check_started',
      id: 'chk_new',
      runId: 'run_1',
      messageId: 'msg_1',
      attempt: 0,
      checkId: 'tests',
      name: 'tests',
      command: 'pnpm test',
      startedAt: 9,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.deepEqual(
      result.data.checkResults?.map((c) => c.id),
      ['chk_new'],
    )
  })

  it('keeps a check from a different attempt', () => {
    const data = cache('running', { checkResults: [checkResult({ id: 'chk_old', attempt: 0 })] })
    const result = applyRunLiveEvent(data, {
      type: 'check_started',
      id: 'chk_new',
      runId: 'run_1',
      messageId: 'msg_1',
      attempt: 1,
      checkId: 'tests',
      name: 'tests',
      command: 'pnpm test',
      startedAt: 9,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.checkResults?.length, 2)
  })
})

describe('applyRunLiveEventToRunRow', () => {
  const run = { id: 'run_1', status: 'success', stdout: '', stderr: '', exitCode: 1 }

  it('flips the row back to running when a follow-up turn starts', () => {
    const result = applyRunLiveEventToRunRow(run, {
      type: 'turn_started',
      userMessageId: 'm1',
      assistantMessageId: 'm2',
      prompt: 'again',
      createdAt: 1,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.status, 'running')
    assert.equal(result.data.exitCode, null)
  })

  it('takes the verdict, and ignores the per-message frames it cannot hold', () => {
    const verdict = applyRunLiveEventToRunRow(run, {
      type: 'verdict',
      verdict: 'verified',
      repairAttempts: 0,
    })
    assert.equal(verdict.action, 'patch')

    for (const event of [
      turnEvent('tev_1'),
      { type: 'repair_started' as const, attempt: 1, maxAttempts: 2 },
      { type: 'check_finished' as const, result: checkResult() },
    ]) {
      assert.equal(applyRunLiveEventToRunRow(run, event).action, 'ignore')
    }
  })

  it('patches status on the bare run row', () => {
    const result = applyRunLiveEventToRunRow(run, {
      type: 'status',
      status: 'success',
      exitCode: 0,
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.status, 'success')
    assert.equal(result.data.exitCode, 0)
  })

  it('appends log chunks to the run row too', () => {
    const result = applyRunLiveEventToRunRow(run, {
      type: 'log',
      stream: 'stderr',
      chunk: 'boom',
      messageId: 'm1',
    })
    assert.equal(result.action, 'patch')
    if (result.action !== 'patch') return
    assert.equal(result.data.stderr, 'boom')
  })
})
