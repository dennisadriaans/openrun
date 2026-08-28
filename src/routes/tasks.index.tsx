import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo } from 'react'
import { NeedProjectEmpty } from '../components/NeedProjectEmpty'
import { Button, Card, EmptyState, PageHeader, StatusBadge } from '../components/ui'
import { DEMO_RUNNING_TASK_ID, demoTasks, isDemoMode, type DemoTask } from '../lib/demoData.ts'
import { absoluteTime, describeCron, relativeTime, taskScheduleStatus } from '../lib/format'
import { automationsEmptyKind } from '../lib/projectGate'
import { useProjects, useRuns, useTasks } from '../lib/queries'
import { runNowBlockedReason } from '../lib/runNowGate'
import { queueDepthLabel } from '../lib/runQueue'

type TaskRow = NonNullable<ReturnType<typeof useTasks>['data']>[number]
type ListTask = DemoTask | TaskRow

export const Route = createFileRoute('/tasks/')({ component: TasksPage })

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,7rem)_5rem] sm:grid-cols-[6.5rem_minmax(0,1fr)_8rem_minmax(0,10rem)_5.5rem]'

/**
 * One cell, not eight chips. A blocked automation says the one thing standing
 * in the way; a healthy one says its cadence and any backlog behind it.
 */
function scheduleCell(t: ListTask, blocked: string | null): string {
  if (blocked) return blocked
  const parts = [
    t.webhookIntegrationId?.trim() && !t.cron.trim() ? 'Webhook' : describeCron(t.cron),
  ]
  if (t.queuedCount > 0) parts.push(queueDepthLabel(t.queuedCount))
  if (
    t.lastScheduleFire &&
    ['failed', 'missed', 'skipped'].includes(t.lastScheduleFire.outcome) &&
    t.lastScheduleFire.observedAt > (t.lastRunAt ?? 0)
  ) {
    parts.push(t.lastScheduleFire.detail || t.lastScheduleFire.outcome)
  }
  return parts.join(' · ')
}

/** Next fire when the schedule is live, otherwise the last one, self-labelled. */
function whenCell(t: ListTask): { text: string; title: string } {
  if (t.enabled && t.nextRunAt)
    return { text: relativeTime(t.nextRunAt), title: absoluteTime(t.nextRunAt) }
  if (t.lastRunAt)
    return { text: `last ${relativeTime(t.lastRunAt)}`, title: absoluteTime(t.lastRunAt) }
  return { text: '—', title: 'Never run' }
}

function TasksPage() {
  const demo = isDemoMode()
  const { data: liveTasks, isLoading: liveLoading } = useTasks()
  const { data: projects, isLoading: liveLoadingProjects } = useProjects()
  const { data: runs } = useRuns()
  const tasks = demo ? demoTasks(Date.now()) : liveTasks
  const isLoading = demo ? false : liveLoading
  const loadingProjects = demo ? false : liveLoadingProjects
  const runningTaskIds = useMemo(
    () =>
      demo
        ? new Set([DEMO_RUNNING_TASK_ID])
        : new Set(runs?.filter((r) => r.status === 'running').map((r) => r.taskId) ?? []),
    [demo, runs],
  )
  const navigate = useNavigate()
  const emptyKind = demo ? null : automationsEmptyKind(projects?.length ?? 0)

  const newTask = () => navigate({ to: '/tasks/new' })

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Automations"
        actions={
          <Button variant="primary" onClick={newTask}>
            <Plus className="h-3.5 w-3.5" />
            New automation
          </Button>
        }
      />

      {isLoading || loadingProjects ? (
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      ) : tasks && tasks.length > 0 ? (
        <Card className="divide-y divide-[var(--border-quaternary)]">
          <div className={`${ROW_GRID} px-4 py-2 text-ui-sm text-tier-quaternary`}>
            <span>Status</span>
            <span>Automation</span>
            <span className="hidden sm:block">Runtime</span>
            <span>Schedule</span>
            <span className="text-right">Next run</span>
          </div>
          {tasks.map((t) => {
            const runBlocked = runNowBlockedReason(t)
            const schedule = scheduleCell(t, runBlocked)
            const when = whenCell(t)
            return (
              <div
                key={t.id}
                className={`relative ${ROW_GRID} px-4 py-2 transition-colors hover:bg-hover`}
              >
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: t.id }}
                  className="absolute inset-0"
                  aria-label={t.name}
                />
                <StatusBadge status={taskScheduleStatus(!!t.enabled, runningTaskIds.has(t.id))} />
                <span className="truncate text-ui-base text-foreground">{t.name}</span>
                <span className="hidden truncate text-ui-sm text-tier-quaternary sm:block">
                  {t.runtimeLabel}
                </span>
                <span
                  className={`truncate text-ui-sm ${runBlocked ? 'text-warn' : 'text-tier-tertiary'}`}
                  title={schedule}
                >
                  {schedule}
                </span>
                <span
                  className="text-right text-ui-sm tabular-nums text-tier-quaternary"
                  title={when.title}
                >
                  {when.text}
                </span>
              </div>
            )
          })}
        </Card>
      ) : emptyKind === 'need-project' ? (
        <NeedProjectEmpty />
      ) : (
        <EmptyState title="No automations yet">
          Describe a job once, pick when it runs, and an agent does it for you.
          <div className="mt-3">
            <Button variant="primary" onClick={newTask}>
              <Plus className="h-3.5 w-3.5" /> New automation
            </Button>
          </div>
        </EmptyState>
      )}
    </div>
  )
}
