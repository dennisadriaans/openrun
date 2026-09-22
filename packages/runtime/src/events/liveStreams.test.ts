import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { activityLiveSubscriberCount, createActivityLiveSseStream } from './activityLive.ts'
import { createRunLiveSseStream, runLiveSubscriberCount } from './runLive.ts'

describe('SSE stream teardown', () => {
  it('releases a run subscriber when the response reader is cancelled', async () => {
    const runId = 'run_cancelled_reader'
    const stream = createRunLiveSseStream(runId, {
      status: 'running',
      signal: new AbortController().signal,
    })
    const reader = stream.getReader()

    assert.equal(runLiveSubscriberCount(runId), 1)
    await reader.cancel()
    assert.equal(runLiveSubscriberCount(runId), 0)
  })

  it('releases an activity subscriber when the response reader is cancelled', async () => {
    const stream = createActivityLiveSseStream({
      signal: new AbortController().signal,
    })
    const reader = stream.getReader()

    assert.equal(activityLiveSubscriberCount(), 1)
    await reader.cancel()
    assert.equal(activityLiveSubscriberCount(), 0)
  })
})
