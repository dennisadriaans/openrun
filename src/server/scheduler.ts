/**
 * Durable local scheduler.
 *
 * Recurring cron jobs use node-cron in the machine timezone. One-shot jobs use
 * an absolute timestamp, catch up within a short grace window, and otherwise
 * become a visible missed fire instead of silently moving to tomorrow.
 */
import parser from 'cron-parser'
import cron, { type TaskContext } from 'node-cron'
import { caughtUpFireDetail, missedFireDecision, missedFireDetail } from '../lib/missedFires.ts'
import { oneShotDecision } from '../lib/oneShotSchedule.ts'
import { hasWorkspaceId } from '../lib/workspaceRef'
import { getDb, type RuntimeRow, type TaskRow } from './db'
import { runTask } from './executor'
import { isShuttingDown } from './processControl'
import { drainAllQueues, enqueueRun, workspaceBusy, WORKSPACE_BUSY_MESSAGE } from './runQueue'
import { lastFireObservedAt, recordScheduleFire, settleScheduleFire } from './scheduleFires.ts'
import { isSchedulableCron } from './cronValidation.ts'
import { unattendedRefusal } from './unattendedPreflight'

const MAX_TIMER_MS = 2_147_000_000
type Scheduled = {
  stop: () => void | Promise<void>
  destroy?: () => void | Promise<void>
  on?: (event: 'execution:missed', listener: (context: TaskContext) => void) => void
}

const g = globalThis as unknown as {
  __agentopsJobs?: Map<string, Scheduled>
  __agentopsBooted?: boolean
}

function jobs(): Map<string, Scheduled> {
  if (!g.__agentopsJobs) g.__agentopsJobs = new Map()
  return g.__agentopsJobs
}

function disableAfterScheduleFire(taskId: string) {
  getDb()
    .prepare('UPDATE tasks SET enabled = 0, updatedAt = ? WHERE id = ?')
    .run(Date.now(), taskId)
  unscheduleTask(taskId)
}

function refusal(task: TaskRow): { outcome: 'skipped' | 'failed'; detail: string } | null {
  if (!task.enabled && !task.fireOnce) {
    return { outcome: 'skipped', detail: 'Automation is paused.' }
  }
  if (!hasWorkspaceId(task.workspaceId)) {
    return { outcome: 'failed', detail: 'Automation has no workspace.' }
  }
  const runtime = getDb().prepare('SELECT * FROM runtimes WHERE id = ?').get(task.runtimeId) as
    | RuntimeRow
    | undefined
  // Busy-first is important: a healthy run is expected to dirty or switch its
  // worktree while it is active. Let that fire queue, then inspect the tree
  // after the owner has really finished.
  if (workspaceBusy(task.workspaceId)) return null
  if (!runtime) return { outcome: 'failed', detail: 'Runtime not found for automation.' }
  // Nobody is watching this fire: refuse a shared checkout, a contaminated
  // worktree, or a GitHub capability that is not actually usable, rather than
  // spending an agent turn discovering it.
  const refused = unattendedRefusal(task, runtime)
  if (refused) return { outcome: 'failed', detail: refused }
  return null
}

/**
 * `note` explains an out-of-band fire — today, that it is catching up on a
 * schedule Open Run was not running for. It rides along on whatever outcome
 * the fire settles on, so the audit says why the run happened off-schedule.
 */
function fireTask(taskId: string, scheduledFor: number, note?: string): void {
  if (isShuttingDown()) return
  const db = getDb()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (!task) {
    recordScheduleFire({
      taskId,
      scheduledFor,
      outcome: 'skipped',
      detail: 'Automation was deleted before the scheduled fire.',
    })
    return
  }

  const blocked = refusal(task)
  if (blocked) {
    recordScheduleFire({
      taskId,
      scheduledFor,
      ...blocked,
      detail: note ? `${note} ${blocked.detail}` : blocked.detail,
    })
    if (task.fireOnce) disableAfterScheduleFire(task.id)
    return
  }

  const runtime = db
    .prepare('SELECT * FROM runtimes WHERE id = ?')
    .get(task.runtimeId) as RuntimeRow
  try {
    const runId = runTask(task, runtime, 'schedule')
    recordScheduleFire({ taskId, scheduledFor, outcome: 'started', runId, detail: note ?? '' })
    if (task.fireOnce) disableAfterScheduleFire(task.id)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (detail === WORKSPACE_BUSY_MESSAGE) {
      const fire = recordScheduleFire({ taskId, scheduledFor, outcome: 'queued' })
      const result = enqueueRun({
        taskId: task.id,
        workspaceId: task.workspaceId,
        trigger: 'schedule',
        scheduleFireId: fire.id,
      })
      if (!result.queued) {
        settleScheduleFire(fire.id, { outcome: 'skipped', detail: result.reason })
      }
    } else {
      recordScheduleFire({ taskId, scheduledFor, outcome: 'failed', detail })
      console.error(`[scheduler] failed to start task ${task.id}:`, err)
    }
    if (task.fireOnce) disableAfterScheduleFire(task.id)
  }
}

function inferLegacyOneShotAt(task: TaskRow): number {
  try {
    const scheduledAt = parser.parseExpression(task.cron).next().getTime()
    getDb()
      .prepare('UPDATE tasks SET scheduledAt = ?, updatedAt = ? WHERE id = ?')
      .run(scheduledAt, Date.now(), task.id)
    return scheduledAt
  } catch {
    return 0
  }
}

function scheduleOneShot(task: TaskRow): void {
  const scheduledAt = task.scheduledAt || inferLegacyOneShotAt(task)
  const decision = oneShotDecision(scheduledAt)
  if (decision.kind === 'invalid') {
    recordScheduleFire({
      taskId: task.id,
      scheduledFor: scheduledAt,
      outcome: 'failed',
      detail: 'One-shot automation has no valid absolute fire time.',
    })
    disableAfterScheduleFire(task.id)
    return
  }
  if (decision.kind === 'miss') {
    recordScheduleFire({
      taskId: task.id,
      scheduledFor: scheduledAt,
      outcome: 'missed',
      detail: 'Open Run was unavailable beyond the 15-minute one-shot grace window.',
    })
    disableAfterScheduleFire(task.id)
    return
  }
  if (decision.kind === 'fire') {
    queueMicrotask(() => fireTask(task.id, scheduledAt))
    return
  }

  const timeout = setTimeout(
    () => {
      if (decision.delayMs > MAX_TIMER_MS) syncTask(task.id)
      else {
        const atFire = oneShotDecision(scheduledAt)
        if (atFire.kind === 'miss') {
          recordScheduleFire({
            taskId: task.id,
            scheduledFor: scheduledAt,
            outcome: 'missed',
            detail: 'The machine was asleep beyond the 15-minute one-shot grace window.',
          })
          disableAfterScheduleFire(task.id)
        } else {
          fireTask(task.id, scheduledAt)
        }
      }
    },
    Math.min(decision.delayMs, MAX_TIMER_MS),
  )
  jobs().set(task.id, { stop: () => clearTimeout(timeout) })
}

function scheduleTask(task: TaskRow) {
  if (!task.enabled || !task.cron.trim()) return
  if (!isSchedulableCron(task.cron)) return
  if (task.fireOnce) {
    scheduleOneShot(task)
    return
  }

  const handle = cron.schedule(task.cron, (context) => fireTask(task.id, context.date.getTime()))
  handle.on('execution:missed', (context) => {
    recordScheduleFire({
      taskId: task.id,
      scheduledFor: context.date.getTime(),
      outcome: 'missed',
      detail: 'The scheduler process could not observe this recurring fire in time.',
    })
  })
  jobs().set(task.id, handle)
}

/**
 * Account for the fires this automation was due while Open Run was not running.
 *
 * `node-cron` only sees ticks a live process is there to observe, so a laptop
 * closed overnight silently skipped every recurring automation and left no
 * trace — the page still read "next run in 18 hours". One-shots already had a
 * grace window; this gives recurring schedules the same treatment.
 *
 * At most one catch-up run per automation, for the newest missed occurrence.
 * Replaying a whole night's backlog the moment a laptop opens would be worse
 * than missing it.
 */
function reconcileMissedFires(task: TaskRow): void {
  if (task.fireOnce) return
  if (!task.enabled || !task.cron.trim()) return
  if (!isSchedulableCron(task.cron)) return

  // Only the window this install is answerable for: the last fire we recorded,
  // else when the automation was last saved. Without that floor, arming a
  // brand-new automation would "discover" every occurrence since the epoch.
  const since = Math.max(lastFireObservedAt(task.id), task.updatedAt || task.createdAt || 0)
  if (since <= 0) return

  const decision = missedFireDecision({ cron: task.cron, since, now: Date.now() })
  if (decision.kind === 'none') return

  if (decision.kind === 'missed') {
    recordScheduleFire({
      taskId: task.id,
      scheduledFor: decision.scheduledFor,
      outcome: 'missed',
      detail: missedFireDetail({
        missedCount: decision.missedCount,
        capped: decision.capped,
        lateByMs: decision.lateByMs,
      }),
    })
    return
  }

  // Fresh enough to still be worth running. Deferred so every automation is
  // armed before any of them starts competing for a workspace.
  const note = caughtUpFireDetail({
    missedCount: decision.missedCount,
    capped: decision.capped,
  })
  queueMicrotask(() => fireTask(task.id, decision.scheduledFor, note))
}

/** (Re)register a single task's trigger, replacing any existing schedule. */
export function syncTask(taskId: string) {
  unscheduleTask(taskId)
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
    | TaskRow
    | undefined
  if (task) scheduleTask(task)
}

export function unscheduleTask(taskId: string) {
  const existing = jobs().get(taskId)
  if (!existing) return
  void existing.stop()
  void existing.destroy?.()
  jobs().delete(taskId)
}

/** Boot once, isolate broken rows, and recover any durable workspace queue. */
export function bootScheduler() {
  if (g.__agentopsBooted) return
  g.__agentopsBooted = true
  const tasks = getDb()
    .prepare("SELECT * FROM tasks WHERE enabled = 1 AND cron != ''")
    .all() as TaskRow[]
  for (const task of tasks) {
    try {
      scheduleTask(task)
    } catch (err) {
      console.error(`[scheduler] failed to arm task ${task.id}:`, err)
    }
    // Arming only covers fires from now on. Anything due while the process was
    // down is accounted for separately, and never at the cost of arming.
    try {
      reconcileMissedFires(task)
    } catch (err) {
      console.error(`[scheduler] failed to reconcile missed fires for ${task.id}:`, err)
    }
  }
  try {
    drainAllQueues()
  } catch (err) {
    console.error('[scheduler] initial queue drain failed:', err)
  }
}
