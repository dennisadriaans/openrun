import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const root = mkdtempSync(join(tmpdir(), 'openrun-schedule-fires-'))
const cwdBefore = process.cwd()
const previousHome = process.env.OPENRUN_HOME
process.env.OPENRUN_HOME = join(root, '.openrun')
process.chdir(root)

const { closeDb, getDb } = await import('./db.ts')
const { latestScheduleFires, recordScheduleFire, settleScheduleFire } = await import(
  './scheduleFires.ts'
)

after(() => {
  closeDb()
  process.chdir(cwdBefore)
  if (previousHome === undefined) delete process.env.OPENRUN_HOME
  else process.env.OPENRUN_HOME = previousHome
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

describe('refused fire notifications', () => {
  // A webhook nobody is listening on: delivery fails, but a delivery *row* is
  // written either way, which is what proves the notifier was reached at all.
  const DEAD_WEBHOOK = 'http://127.0.0.1:1/hook'

  function seedNotifier() {
    const db = getDb()
    db.exec(
      'DELETE FROM notification_deliveries; DELETE FROM notifiers; DELETE FROM schedule_fires',
    )
    db.prepare(
      `INSERT INTO notifiers (id, kind, name, target, verdicts, enabled, createdAt, updatedAt)
       VALUES ('ntf-1', 'webhook', 'Dead webhook', ?, '["verified"]', 1, 1, 1)`,
    ).run(DEAD_WEBHOOK)
  }

  function deliveryCount(): number {
    return (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM notification_deliveries WHERE verdict = 'refused'")
        .get() as { n: number }
    ).n
  }

  async function settledCount(expected: number): Promise<number> {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      if (deliveryCount() >= expected) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    // Give a late duplicate a chance to land, so "no new delivery" is a real
    // assertion rather than a race we happened to win.
    await new Promise((resolve) => setTimeout(resolve, 100))
    return deliveryCount()
  }

  it('notifies once for a refusal, stays quiet while it persists, speaks up on a new reason', async () => {
    seedNotifier()

    recordScheduleFire({
      taskId: 'task-refused',
      scheduledFor: 1,
      outcome: 'failed',
      detail: 'dirty worktree',
    })
    assert.equal(await settledCount(1), 1, 'first refusal should notify')

    recordScheduleFire({
      taskId: 'task-refused',
      scheduledFor: 2,
      outcome: 'failed',
      detail: 'dirty worktree',
    })
    assert.equal(await settledCount(1), 1, 'the same refusal should not notify twice')

    recordScheduleFire({
      taskId: 'task-refused',
      scheduledFor: 3,
      outcome: 'failed',
      detail: 'gh is logged out',
    })
    assert.equal(await settledCount(2), 2, 'a new reason should notify again')
  })

  it('says nothing when a fire actually started', async () => {
    seedNotifier()
    recordScheduleFire({ taskId: 'task-ok', scheduledFor: 1, outcome: 'started', runId: 'run-1' })
    assert.equal(await settledCount(0), 0)
  })

  it('notifies when a queued fire settles as failed', async () => {
    seedNotifier()
    const fire = recordScheduleFire({ taskId: 'task-queued', scheduledFor: 1, outcome: 'queued' })
    assert.equal(await settledCount(0), 0)
    settleScheduleFire(fire.id, { outcome: 'failed', detail: 'runtime went away' })
    assert.equal(await settledCount(1), 1)
  })
})
