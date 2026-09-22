import { formatScheduledRunLabel } from '@openrun/domain/tasks/schedule'
import type { TaskChoice } from '../commands/cliResolve.ts'
import { unavailable, type CliClient } from '../runtime/local.ts'
import type { CliUi } from './ui.ts'
import { watchActivity } from '../session/activity.ts'
import type { HomeOverview } from '../session/session.ts'

export type TaskRowView = TaskChoice & {
  prompt?: string
  cron?: string
  fireOnce?: number
  scheduledAt?: number
  runtimeId?: string
  nextRunAt?: number | null
  webhookIntegrationId?: string
  readinessBlockers?: { message: string }[]
}

type DashboardRun = { id: string; taskName?: string; status: string }
type Dashboard = {
  stats: { running: number; runsToday: number }
  activeRuns?: DashboardRun[]
  recentRuns?: DashboardRun[]
  pending?: { id: string; taskName: string }[]
}

/** Use the worker's readiness and timestamps, including for remote targets. */
export function taskTiming(task: TaskRowView): string {
  if (!task.enabled) return 'Paused'
  if (task.readinessBlockers?.length)
    return `Needs attention · ${task.readinessBlockers[0]!.message}`
  if (task.nextRunAt) {
    const when = formatScheduledRunLabel(task.nextRunAt)?.replace(/^Scheduled /, '')
    return `${when}${task.fireOnce ? ' · once' : ''}`
  }
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
      ).map((run) => ({ id: run.id, prompt: run.taskName || run.id, when: 'Running' })),
      ...(dashboard.pending ?? []).map((run) => ({
        id: run.id,
        prompt: run.taskName,
        when: 'Queued run',
      })),
    ]
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
  ui: Pick<CliUi, 'overview' | 'status' | 'runChanged'>,
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
      if (event.type === 'run_changed') ui.runChanged(event.runId, event.status)
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
