import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'openrun-schedule-fires-'))
const cwdBefore = process.cwd()
process.chdir(root)

const { latestScheduleFires, recordScheduleFire, settleScheduleFire } = await import(
  './scheduleFires.ts'
)

after(() => {
  process.chdir(cwdBefore)
  rmSync(root, { recursive: true, force: true })
})

describe('schedule fire audit', () => {
  it('records and settles a queued fire without losing its scheduled time', () => {
    const fire = recordScheduleFire({
      taskId: 'task-1',
      scheduledFor: 1_700_000_000_000,
      outcome: 'queued',
    })
    settleScheduleFire(fire.id, {
      outcome: 'started',
      runId: 'run-1',
    })

    const latest = latestScheduleFires(['task-1'])['task-1']
    assert.equal(latest?.scheduledFor, 1_700_000_000_000)
    assert.equal(latest?.outcome, 'started')
    assert.equal(latest?.runId, 'run-1')
  })
})
