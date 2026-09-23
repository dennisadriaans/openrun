import type { TaskChoice } from '../commands/cliResolve.ts'
import { unavailable, type CliClient } from '../runtime/local.ts'
import type { CliUi } from './ui.ts'
import { watchActivity } from '../session/activity.ts'
import { runStatusLabel, type HomeOverview } from '../session/session.ts'
import { scheduleTime } from './schedule.ts'

export type TaskRowView = TaskChoice & {
  prompt?: string
  cron?: string
  fireOnce?: number
  scheduledAt?: number
  runtimeId?: string
  model?: string
  effort?: string
  nextRunAt?: number | null
  webhookIntegrationId?: string
  readinessBlockers?: { message: string }[]
}

type DashboardRun = {
  id: string
  taskId?: string | null
  taskName?: string
  prompt?: string
  model?: string
  effort?: string
  status: string
  startedAt?: number
}
type Dashboard = {
  stats: { running: number; runsToday: number }
  activeRuns?: DashboardRun[]
  recentRuns?: DashboardRun[]
  pending?: {
    id: string
    taskId?: string
    taskName: string
    prompt?: string
    queuedAt?: number
  }[]
}

/** Use the worker's readiness and timestamps, including for remote targets. */
export function taskTiming(task: TaskRowView): string {
  if (!task.enabled) return 'Paused'
  if (task.readinessBlockers?.length)
    return `Needs attention · ${task.readinessBlockers[0]!.message}`
  if (task.nextRunAt) return scheduleTime(task.nextRunAt)
  if (task.webhookIntegrationId) return 'On integration event'
  return task.cron?.trim() ? 'No next run scheduled' : 'Manual only'
}

export async function showHome(client: CliClient, ui: Pick<CliUi, 'overview'>): Promise<void> {
  const [tasksResult, dashboardResult, integrationsResult] = await Promise.allSettled([
    client.call('tasks.list') as Promise<TaskRowView[]>,
    client.call('dashboard.dashboard') as Promise<Dashboard>,
    client.call('integrations.list') as Promise<{ enabled: number | boolean }[]>,
  ])
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : undefined
  const scheduled = tasks
    ?.filter((task) => task.enabled && task.nextRunAt && !task.readinessBlockers?.length)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)
  const overview: HomeOverview = { error: '' }
  if (tasks) {
    overview.automations = tasks.length
    overview.scheduled = scheduled!.length
    overview.tasks = scheduled!.map((task) => ({
      id: task.id,
      prompt: task.prompt?.trim() || task.name,
      when: taskTiming(task),
      model: task.model ?? '',
      effort: task.effort ?? '',
    }))
  }
  if (dashboardResult.status === 'fulfilled') {
    const dashboard = dashboardResult.value
    overview.running = dashboard.stats.running
    overview.runs = dashboard.stats.runsToday
    overview.activeRuns = [
      ...(
        dashboard.activeRuns ??
        dashboard.recentRuns?.filter((run) => run.status === 'running') ??
        []
      ).map((active) => {
        const run = { ...dashboard.recentRuns?.find((row) => row.id === active.id), ...active }
        return {
          id: run.id,
          taskId: run.taskId,
          startedAt: run.startedAt,
          prompt: run.prompt || run.taskName || 'Untitled task',
          when: runStatusLabel(run.status),
          time: run.startedAt ? scheduleTime(run.startedAt) : undefined,
          model: run.model,
          effort: run.effort,
        }
      }),
      ...(dashboard.pending ?? []).map((run) => {
        const task = tasks?.find((task) => task.id === run.taskId)
        return {
          id: run.id,
          taskId: run.taskId,
          prompt: run.prompt || task?.prompt || run.taskName,
          when: 'Queued',
          time: run.queuedAt ? scheduleTime(run.queuedAt) : undefined,
          model: task ? (task.model ?? '') : undefined,
          effort: task ? (task.effort ?? '') : undefined,
        }
      }),
    ]
    overview.recentRuns = (dashboard.recentRuns ?? []).map((run) => ({
      id: run.id,
      taskId: run.taskId,
      startedAt: run.startedAt,
      prompt: run.prompt || run.taskName || 'Untitled task',
      when: runStatusLabel(run.status),
      time: run.startedAt ? scheduleTime(run.startedAt) : undefined,
      model: run.model,
      effort: run.effort,
    }))
  }
  if (integrationsResult.status === 'fulfilled')
    overview.integrations = integrationsResult.value.filter((row) => row.enabled).length
  const failures = [tasksResult, dashboardResult, integrationsResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failures.length === 3 && failures.every((result) => unavailable(result.reason))) {
    overview.error = 'Worker stopped · type worker start to restart. Showing last known status.'
  } else if (failures.length) {
    const reason = failures[0]!.reason
    overview.error = `Could not refresh overview: ${reason instanceof Error ? reason.message : String(reason)}. Type refresh to retry.`
  }
  ui.overview(overview)
}

/** Live for the entire session, including while a request is being saved. */
export function watchHome(
  client: CliClient,
  ui: Pick<CliUi, 'overview' | 'status' | 'runChanged'> &
    Partial<Pick<CliUi, 'takeRunsAwaitingChanges' | 'runChanges'>>,
  {
    url = '',
    token = '',
    firstLoad = client,
    watch = watchActivity,
  }: { url?: string; token?: string; firstLoad?: CliClient; watch?: typeof watchActivity } = {},
): { refresh: () => void; stop: () => void } {
  let active = true
  let healthy = false
  let loading = false
  let again = false
  let revision = 0
  let debounce: ReturnType<typeof setTimeout> | undefined
  // A finished run's file changes are read once, so Activity can say what there is to review.
  const loadChanges = () => {
    for (const runId of ui.takeRunsAwaitingChanges?.() ?? []) {
      void client.call('runs.getWorkspace', { runId }).then(
        (result) => {
          const workspace = result as {
            files?: unknown[]
            totals?: { additions: number; deletions: number }
          } | null
          if (active && workspace?.files)
            ui.runChanges?.(runId, {
              files: workspace.files.length,
              additions: workspace.totals?.additions ?? 0,
              deletions: workspace.totals?.deletions ?? 0,
            })
        },
        () => {},
      )
    }
  }
  const refresh = async (source = client) => {
    if (!active) return
    if (loading) {
      again = true
      return
    }
    loading = true
    const startedAtRevision = revision
    try {
      await showHome(source, {
        overview: (overview: HomeOverview) => {
          if (active && startedAtRevision === revision) ui.overview(overview)
        },
      })
      loadChanges()
    } finally {
      loading = false
      if (again && active) {
        again = false
        void refresh()
      }
    }
  }
  const schedule = () => {
    if (debounce || !active) return
    revision++
    debounce = setTimeout(() => {
      debounce = undefined
      void refresh()
    }, 100)
  }
  ui.status(url ? `Remote · ${url}` : 'Local worker')
  void refresh(firstLoad)
  const stop = watch({
    url,
    token,
    onChange: schedule,
    onEvent: (event) => {
      if (event.type === 'run_changed') {
        ui.runChanged(event.runId, event.status)
        loadChanges()
      }
    },
    onHealthy: (value) => {
      healthy = value
      ui.status(
        `${url ? 'Remote' : 'Local'} · ${value ? 'Live updates' : 'Reconnecting · refresh every 3s'}`,
      )
    },
  })
  const fallback = setInterval(() => {
    if (!healthy) schedule()
  }, 3000)
  return {
    refresh: schedule,
    stop: () => {
      active = false
      stop()
      clearTimeout(debounce)
      clearInterval(fallback)
    },
  }
}
