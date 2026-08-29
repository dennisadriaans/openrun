/**
 * Durable local scheduler.
 *
 * Recurring cron jobs use node-cron in the machine timezone. One-shot jobs use
 * an absolute timestamp, catch up within a short grace window, and otherwise
 * become a visible missed fire instead of silently moving to tomorrow.
 */
import parser from 'cron-parser'
import cron, { type TaskContext } from 'node-cron'
import { oneShotDecision } from '../lib/oneShotSchedule.ts'
import { hasWorkspaceId } from '../lib/workspaceRef'
import { getDb, type RuntimeRow, type TaskRow } from './db'
import { runTask } from './executor'
import { isShuttingDown } from './processControl'
import { drainAllQueues, enqueueRun, workspaceBusy, WORKSPACE_BUSY_MESSAGE } from './runQueue'
import { recordScheduleFire, settleScheduleFire } from './scheduleFires.ts'
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

function fireTask(taskId: string, scheduledFor: number): void {
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
    recordScheduleFire({ taskId, scheduledFor, ...blocked })
    if (task.fireOnce) disableAfterScheduleFire(task.id)
    return
  }

  const runtime = db
    .prepare('SELECT * FROM runtimes WHERE id = ?')
    .get(task.runtimeId) as RuntimeRow
  try {
    const runId = runTask(task, runtime, 'schedule')
    recordScheduleFire({ taskId, scheduledFor, outcome: 'started', runId })
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
  }
  try {
    drainAllQueues()
  } catch (err) {
    console.error('[scheduler] initial queue drain failed:', err)
  }
}
