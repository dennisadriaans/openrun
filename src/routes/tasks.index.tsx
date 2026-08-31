import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NeedProjectEmpty } from '../components/NeedProjectEmpty'
import { Button, Card, EmptyState, Modal, PageHeader, StatusBadge } from '../components/ui'
import { DEMO_RUNNING_TASK_ID, demoTasks, isDemoMode, type DemoTask } from '../lib/demoData.ts'
import { absoluteTime, describeSchedule, relativeTime, taskScheduleStatus } from '../lib/format'
import { normalizeSelection, selectionState, toggleSelection } from '../lib/listSelection.ts'
import { automationsEmptyKind } from '../lib/projectGate'
import { useDeleteTasks, useProjects, useRunningTaskIds, useTasks } from '../lib/queries'
import { runNowBlockedReason } from '../lib/runNowGate'
import { queueDepthLabel } from '../lib/runQueue'

type TaskRow = NonNullable<ReturnType<typeof useTasks>['data']>[number]
type ListTask = DemoTask | TaskRow

export const Route = createFileRoute('/tasks/')({ component: TasksPage })

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_minmax(0,7rem)_5rem] sm:grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_8rem_minmax(0,10rem)_5.5rem]'

/**
 * One cell, not eight chips. A blocked automation says the one thing standing
 * in the way; a healthy one says its cadence and any backlog behind it.
 */
function scheduleCell(t: ListTask, blocked: string | null): string {
  if (blocked) return blocked
  const parts = [t.webhookIntegrationId?.trim() && !t.cron.trim() ? 'Webhook' : describeSchedule(t)]
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
  const { data: runningIds } = useRunningTaskIds()
  const tasks = demo ? demoTasks(Date.now()) : liveTasks
  const isLoading = demo ? false : liveLoading
  const loadingProjects = demo ? false : liveLoadingProjects
  const runningTaskIds = useMemo(
    () => (demo ? new Set([DEMO_RUNNING_TASK_ID]) : new Set(runningIds ?? [])),
    [demo, runningIds],
  )
  const navigate = useNavigate()
  const emptyKind = demo ? null : automationsEmptyKind(projects?.length ?? 0)
  const deleteTasks = useDeleteTasks()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectableIds = useMemo(() => (tasks ?? []).map((t) => t.id), [tasks])
  const pageSelection = selectionState(selectedIds, selectableIds)
  const selectedCount = normalizeSelection(selectedIds, selectableIds).length

  useEffect(() => {
    setSelectedIds((selected) => normalizeSelection(selected, selectableIds))
  }, [selectableIds])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = pageSelection.indeterminate
  }, [pageSelection.indeterminate])

  const newTask = () => navigate({ to: '/tasks/new' })

  const closeBulkDelete = () => {
    deleteTasks.reset()
    setConfirmBulkDelete(false)
  }

  const confirmBulk = async () => {
    const ids = normalizeSelection(selectedIds, selectableIds)
    if (ids.length === 0) return
    try {
      await deleteTasks.mutateAsync(ids)
      setSelectedIds((selected) => selected.filter((id) => !ids.includes(id)))
      closeBulkDelete()
    } catch {
      // Keep the modal open so the accessible error can be retried.
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Automations"
        actions={
          <div className="flex items-center gap-2">
            {selectedCount > 0 ? (
              <Button
                variant="danger"
                onClick={() => {
                  deleteTasks.reset()
                  setConfirmBulkDelete(true)
                }}
                disabled={deleteTasks.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected ({selectedCount})
              </Button>
            ) : null}
            <Button variant="primary" onClick={newTask}>
              <Plus className="h-3.5 w-3.5" />
              New automation
            </Button>
          </div>
        }
      />

      {isLoading || loadingProjects ? (
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      ) : tasks && tasks.length > 0 ? (
        <Card className="divide-y divide-[var(--border-quaternary)]">
          <div className={`${ROW_GRID} px-4 py-2 text-ui-sm text-tier-quaternary`}>
            <span>
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={pageSelection.checked}
                disabled={selectableIds.length === 0 || deleteTasks.isPending}
                aria-label="Select all automations"
                title={
                  selectableIds.length === 0 ? 'No automations to select' : 'Select all automations'
                }
                className="list-selection-checkbox relative z-10 disabled:cursor-not-allowed disabled:opacity-40"
                onChange={(event) => {
                  event.stopPropagation()
                  const checked = event.currentTarget.checked
                  setSelectedIds((selected) => {
                    const next = new Set(selected)
                    for (const id of selectableIds) {
                      if (checked) next.add(id)
                      else next.delete(id)
                    }
                    return [...next]
                  })
                }}
                onClick={(event) => event.stopPropagation()}
              />
            </span>
            <span>Status</span>
            <span>Automation</span>
            <span className="hidden sm:block">Runtime</span>
            <span>Schedule</span>
            <span className="text-right">Next run</span>
          </div>
          {tasks.map((t) => {
            const runBlocked = runNowBlockedReason(t)
            // An armed automation whose worktree has drifted, gone dirty, or
            // lost its gh login still looks scheduled — say so on the row
            // rather than letting it fail at 03:20.
            const afkBlocked = t.enabled ? (t.unattendedBlockedReason ?? null) : null
            const blocked = runBlocked ?? afkBlocked
            const schedule = scheduleCell(t, blocked)
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
                <span className="relative z-10 flex items-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(t.id)}
                    disabled={deleteTasks.isPending}
                    aria-label={`Select ${t.name}`}
                    title={`Select ${t.name}`}
                    className="list-selection-checkbox disabled:cursor-not-allowed disabled:opacity-40"
                    onChange={(event) => {
                      event.stopPropagation()
                      const checked = event.currentTarget.checked
                      setSelectedIds((selected) => toggleSelection(selected, t.id, checked))
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </span>
                <StatusBadge status={taskScheduleStatus(!!t.enabled, runningTaskIds.has(t.id))} />
                <span className="truncate text-ui-base text-foreground">{t.name}</span>
                <span className="hidden truncate text-ui-sm text-tier-quaternary sm:block">
                  {t.runtimeLabel}
                </span>
                <span
                  className={`truncate text-ui-sm ${blocked ? 'text-warn' : 'text-tier-tertiary'}`}
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

      {confirmBulkDelete ? (
        <Modal title="Delete selected automations" onClose={closeBulkDelete}>
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Permanently delete{' '}
              <span className="text-foreground">{selectedCount} selected automations</span>? Their
              schedules stop and any run already in flight is cancelled. This cannot be undone.
            </p>
            {deleteTasks.isError ? (
              <p
                role="alert"
                className="rounded-md border border-danger px-3 py-2 text-ui-base text-danger"
              >
                {deleteTasks.error instanceof Error
                  ? deleteTasks.error.message
                  : String(deleteTasks.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={closeBulkDelete}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => void confirmBulk()}
                disabled={deleteTasks.isPending || selectedCount === 0}
              >
                {deleteTasks.isPending ? 'Deleting…' : `Delete ${selectedCount} automations`}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
