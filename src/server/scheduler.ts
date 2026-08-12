/**
 * Cron scheduler.
 *
 * Registers enabled tasks that have a cron expression with node-cron. The
 * schedule is held in a module singleton (guarded on globalThis) so it survives
 * Vite HMR reloads during dev and is shared across all server-function calls.
 */
import cron from 'node-cron'
import { isValidCron } from '../lib/cron'
import { hasTaskPrompt } from '../lib/taskPrompt'
import { hasWorkspaceId } from '../lib/workspaceRef'
import { isWorkspaceReady } from '../lib/workspaceReady'
import { getDb, type RuntimeRow, type TaskRow } from './db'
import { runTask } from './executor'
import { isShuttingDown } from './processControl'
import { drainAllQueues, enqueueRun } from './runQueue'
import { checkRuntimeInstalled } from './runtimePath'
import { getWorkspace } from './workspaces'

type Scheduled = { stop: () => void }

const g = globalThis as unknown as {
  __agentopsJobs?: Map<string, Scheduled>
  __agentopsBooted?: boolean
}

function jobs(): Map<string, Scheduled> {
  if (!g.__agentopsJobs) g.__agentopsJobs = new Map()
  return g.__agentopsJobs
}

function scheduleTask(task: TaskRow) {
  if (!task.enabled || !task.cron.trim()) return
  // Same rules as upsertTask / TaskForm — never arm an expression we would
  // reject on save (node-cron.validate alone used to diverge silently).
  if (!isValidCron(task.cron)) return
  // Same for workspace — a blank workspaceId would spawn in process.cwd().
  if (!hasWorkspaceId(task.workspaceId)) return
  // And never arm against a creating/error/archived worktree (chat already
  // refused these; automations used to schedule and fail mid-spawn).
  const workspace = getWorkspace(task.workspaceId)
  if (!workspace || !isWorkspaceReady(workspace.status)) return
  // Don't arm a job whose CLI isn't on PATH — enable already refuses; this
  // covers legacy rows that were armed before the binary disappeared.
  const runtimeRow = getDb()
    .prepare('SELECT * FROM runtimes WHERE id = ?')
    .get(task.runtimeId) as RuntimeRow | undefined
  if (!runtimeRow || !checkRuntimeInstalled(runtimeRow.bin).installed) return
  // Same for a blank prompt — enable already refuses; this covers legacy rows
  // armed before Create / Save required Agent Instructions.
  if (!hasTaskPrompt(task.prompt)) return

  const handle = cron.schedule(task.cron, () => {
    if (isShuttingDown()) return
    const db = getDb()
    const fresh = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as TaskRow | undefined
    if (!fresh || !fresh.enabled) return
    if (!hasWorkspaceId(fresh.workspaceId)) return
    const freshWs = getWorkspace(fresh.workspaceId)
    if (!freshWs || !isWorkspaceReady(freshWs.status)) return
    const runtime = db.prepare('SELECT * FROM runtimes WHERE id = ?').get(fresh.runtimeId) as
      | RuntimeRow
      | undefined
    if (!runtime || !checkRuntimeInstalled(runtime.bin).installed) return
    if (!hasTaskPrompt(fresh.prompt)) return
    try {
      runTask(fresh, runtime, 'schedule')
    } catch (err) {
      // The overwhelmingly common failure is "this workspace already has a run
      // in progress" — a long run overlapping the next tick. That used to end
      // here, as a console log with no run row and nothing in the UI. Park it
      // instead so the fire happens late rather than never.
      const result = enqueueRun({
        taskId: fresh.id,
        workspaceId: fresh.workspaceId,
        trigger: 'schedule',
      })
      if (!result.queued) {
        console.error(
          `[scheduler] failed to start task ${fresh.id}: ${String(err)} (not queued: ${result.reason})`,
        )
      }
    }
  })
  jobs().set(task.id, handle)
}

/** (Re)register a single task's cron job, replacing any existing schedule. */
export function syncTask(taskId: string) {
  const existing = jobs().get(taskId)
  if (existing) {
    existing.stop()
    jobs().delete(taskId)
  }
  const db = getDb()
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  if (task) scheduleTask(task)
}

export function unscheduleTask(taskId: string) {
  const existing = jobs().get(taskId)
  if (existing) {
    existing.stop()
    jobs().delete(taskId)
  }
}

/** Boot the scheduler once: load all enabled+cron tasks and register them. */
export function bootScheduler() {
  if (g.__agentopsBooted) return
  g.__agentopsBooted = true
  const db = getDb()
  const tasks = db.prepare("SELECT * FROM tasks WHERE enabled = 1 AND cron != ''").all() as TaskRow[]
  for (const t of tasks) scheduleTask(t)
  // A queue left behind by a crash or a restart would otherwise sit untouched
  // until the next cron tick happened to finish a run in that workspace.
  try {
    drainAllQueues()
  } catch (err) {
    console.error('[scheduler] initial queue drain failed:', err)
  }
}
