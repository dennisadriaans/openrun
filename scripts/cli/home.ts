import { formatScheduledRunLabel } from '../../src/lib/schedule.ts'
import type { TaskChoice } from '../../src/lib/cliResolve.ts'
import { unavailable, type CliClient } from './local.ts'
import type { CliUi } from './ui.ts'
import { watchActivity } from './activity.ts'

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

type Dashboard = { stats: { running: number } }

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

export async function showHome(
  client: CliClient,
  ui: Pick<CliUi, 'note' | 'info' | 'scheduledTasks'>,
): Promise<void> {
  const [tasksResult, dashboardResult] = await Promise.allSettled([
    client.call('tasks.list') as Promise<TaskRowView[]>,
    client.call('dashboard.dashboard') as Promise<Dashboard>,
  ])
  const tasks = tasksResult.status === 'fulfilled' ? tasksResult.value : undefined
  const scheduled = tasks
    ?.filter((task) => task.enabled && task.nextRunAt && !task.readinessBlockers?.length)
    .sort((a, b) => a.nextRunAt! - b.nextRunAt!)
  const running =
    dashboardResult.status === 'fulfilled' ? dashboardResult.value.stats.running : undefined
  const count = (label: string, amount: number | undefined) => `${label} ${amount ?? '—'}`
  const failures = [tasksResult, dashboardResult].filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failures.length === 2 && failures.every((result) => unavailable(result.reason))) {
    ui.info('The local worker is stopped. Choose Background worker to start it.')
  } else if (failures.length) {
    const reason = failures[0]!.reason
    ui.info(
      `Could not refresh overview: ${reason instanceof Error ? reason.message : String(reason)}. Choose Refresh overview to retry.`,
    )
  } else {
    ui.info('')
  }
  ui.note(
    [
      count('Running now', running),
      count('Scheduled', scheduled?.length),
      count('Automations', tasks?.length),
    ].join('   ·   '),
    'Home',
  )
  ui.scheduledTasks(
    (scheduled ?? []).map((task) => ({
      id: task.id,
      prompt: task.prompt?.trim() || task.name,
      when: taskTiming(task),
    })),
  )
}

/** Refresh only the overview; leave the action menu and keyboard focus intact. */
export async function liveHome(
  client: CliClient,
  ui: CliUi,
  {
    url = '',
    token = '',
    firstLoad = client,
  }: { url?: string; token?: string; firstLoad?: CliClient } = {},
): Promise<string> {
  let active = true
  let healthy = false
  let loading = false
  let again = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  // Discard late reads after navigation, rather than overwriting a setup summary.
  const view = {
    info: (message: string) => {
      if (active) ui.info(message)
    },
    note: (message: string, title?: string) => {
      if (active) ui.note(message, title)
    },
    scheduledTasks: (tasks: Parameters<CliUi['scheduledTasks']>[0]) => {
      if (active) ui.scheduledTasks(tasks)
    },
  }
  const refresh = async (source = client) => {
    if (loading) {
      again = true
      return
    }
    loading = true
    try {
      await showHome(source, view)
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
    debounce = setTimeout(() => {
      debounce = undefined
      void refresh()
    }, 100)
  }
  ui.status(url ? `Remote · ${url}` : 'Local worker')
  await refresh(firstLoad)
  const stop = watchActivity({
    url,
    token,
    onChange: schedule,
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
  try {
    return await ui.homeRequest()
  } finally {
    active = false
    stop()
    clearTimeout(debounce)
    clearInterval(fallback)
    ui.status(url ? 'Remote' : 'Local worker')
  }
}
