import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Play, Trash2 } from 'lucide-react'
import { TaskForm } from '../components/TaskForm'
import { WorkspaceReadiness } from '../components/WorkspaceReadiness'
import { useTopBarActions } from '../components/AppChrome'
import { Button, Card, EmptyState, StatusBadge, VerdictBadge } from '../components/ui'
import { duration, relativeTime } from '../lib/format'
import { useDeleteTask, useRunNow, useRuns, useTask } from '../lib/queries'
import { runNowBlockedReason } from '../lib/runNowGate'
import { taskFormInitial } from '../lib/taskFormInitial'
import { taskWorkspaceChangeBlockedReason } from '../lib/taskIsolationGate'

export const Route = createFileRoute('/tasks/$taskId')({
  component: TaskDetail,
})

function TaskDetail() {
  const { taskId } = Route.useParams()
  const { data: task, isLoading } = useTask(taskId)
  const { data: runs } = useRuns(taskId)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const runNow = useRunNow()
  const del = useDeleteTask()

  const runBlocked = task ? runNowBlockedReason(task) : null

  useTopBarActions(
    task ? (
      <>
        <Button
          variant="primary"
          title={runBlocked ?? undefined}
          onClick={() =>
            runNow.mutate(task.id, {
              onSuccess: ({ runId }) => {
                if (runId) {
                  navigate({ to: '/runs/$runId', params: { runId } })
                }
              },
              onError: (err) => {
                window.alert(err instanceof Error ? err.message : String(err))
              },
            })
          }
          disabled={runNow.isPending || runBlocked !== null}
        >
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button
          variant="ghost"
          aria-label="Delete automation"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete automation "${task.name}"?`)) {
              del.mutate(task.id)
              navigate({ to: '/tasks' })
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </>
    ) : null,
  )

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <EmptyState title="Automation not found">
          <Link
            to="/tasks"
            className="text-tier-secondary underline underline-offset-2 hover:text-foreground"
          >
            Back to automations
          </Link>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <TaskForm
        key={task.id}
        initial={taskFormInitial(task)}
        readiness={<WorkspaceReadiness task={task} />}
        workspaceChangeBlockedReason={taskWorkspaceChangeBlockedReason(task)}
        onCancel={() => navigate({ to: '/tasks' })}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['task', taskId] })
          qc.invalidateQueries({ queryKey: ['tasks'] })
        }}
      />

      {runs && runs.length > 0 ? (
        <section className="mx-auto mt-10 max-w-3xl border-t border-[var(--border-quaternary)] pt-6">
          <h2 className="mb-3 text-ui-sm font-medium text-tier-secondary">Runs</h2>
          <Card className="divide-y divide-[var(--border-quaternary)]">
            {runs.map((r) => (
              <Link
                key={r.id}
                to="/runs/$runId"
                params={{ runId: r.id }}
                viewTransition
                className="flex items-center justify-between gap-4 px-4 py-1.5 transition-colors hover:bg-hover"
              >
                <div className="min-w-0">
                  <div className="text-ui-sm text-tier-secondary">
                    {relativeTime(r.startedAt)}
                    <span className="text-tier-quaternary"> · </span>
                    {r.trigger}
                    <span className="text-tier-quaternary"> · </span>
                    <span className="tabular-nums">{duration(r.startedAt, r.finishedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <VerdictBadge verdict={r.verdict} />
                  <StatusBadge status={r.status} />
                </div>
              </Link>
            ))}
          </Card>
        </section>
      ) : null}
    </div>
  )
}
