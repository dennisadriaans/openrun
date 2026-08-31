import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, Modal, PageHeader, StatusBadge } from '../components/ui'
import { demoRuns, isDemoMode } from '../lib/demoData.ts'
import { absoluteTime, duration, relativeTime } from '../lib/format'
import { RUNS_PAGE_SIZE, useDeleteRuns, useRemoveRun, useRunCount, useRuns } from '../lib/queries'
import {
  normalizeRunSelection,
  pageSelectionState,
  runPageNormalizationTarget,
  toggleRunSelection,
} from '../lib/runSelection.ts'

type RunsSearch = { page?: number }

export const Route = createFileRoute('/runs/')({
  validateSearch: (search: Record<string, unknown>): RunsSearch => {
    const raw = search.page
    const page =
      typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : 1
    return { page: Number.isFinite(page) && page >= 1 ? Math.trunc(page) : 1 }
  },
  component: RunsPage,
})

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_4rem_4.5rem_1.75rem] sm:grid-cols-[1.5rem_6.5rem_minmax(0,1fr)_8rem_4rem_4.5rem_1.75rem]'

function RunsPage() {
  const demo = isDemoMode()
  const { page = 1 } = Route.useSearch()
  const { data: liveRuns, isLoading: liveLoading } = useRuns(undefined, false, {
    limit: RUNS_PAGE_SIZE,
    offset: (page - 1) * RUNS_PAGE_SIZE,
  })
  const { data: liveTotal, isSuccess: liveTotalReady } = useRunCount()
  const demoList = demo ? demoRuns(Date.now()) : undefined
  const runs = demoList ?? liveRuns
  const total = demoList ? demoList.length : (liveTotal ?? 0)
  const countReady = demoList !== undefined || liveTotalReady
  const isLoading = demo ? false : liveLoading
  const remove = useRemoveRun()
  const deleteRuns = useDeleteRuns()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const deleteTarget = runs?.find((r) => r.id === deleteId)
  const totalPages = Math.max(1, Math.ceil(total / RUNS_PAGE_SIZE))
  const pageSelection = pageSelectionState(selectedIds, runs ?? [])
  const selectAllRef = useRef<HTMLInputElement>(null)
  const rangeStart = total === 0 ? 0 : (page - 1) * RUNS_PAGE_SIZE + 1
  const rangeEnd = Math.min(page * RUNS_PAGE_SIZE, total)

  const pageTarget = runPageNormalizationTarget({
    page,
    total,
    pageSize: RUNS_PAGE_SIZE,
    countReady,
    rowsLoaded: !isLoading && runs !== undefined,
    rowCount: runs?.length ?? 0,
  })

  useEffect(() => {
    if (pageTarget !== null) {
      navigate({ to: '/runs', search: { page: pageTarget }, replace: true })
    }
  }, [navigate, pageTarget])

  useEffect(() => {
    setSelectedIds((selected) => normalizeRunSelection(selected, runs ?? []))
  }, [runs])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = pageSelection.indeterminate
  }, [pageSelection.indeterminate])

  const newRun = () => navigate({ to: '/runs/new' })

  const closeDelete = () => {
    remove.reset()
    setDeleteId(null)
  }

  const openDelete = (id: string) => {
    remove.reset()
    setDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!deleteId || !deleteTarget) return
    try {
      await remove.mutateAsync(deleteId)
      setSelectedIds((selected) => selected.filter((id) => id !== deleteId))
      closeDelete()
    } catch {
      // Keep the modal open so the accessible error can be retried.
    }
  }

  const closeBulkDelete = () => {
    deleteRuns.reset()
    setConfirmBulkDelete(false)
  }

  const confirmBulk = async () => {
    const ids = normalizeRunSelection(selectedIds, runs ?? [])
    if (ids.length === 0) return
    try {
      await deleteRuns.mutateAsync(ids)
      setSelectedIds((selected) => selected.filter((id) => !ids.includes(id)))
      closeBulkDelete()
    } catch {
      // Keep the modal open so the accessible error can be retried.
    }
  }

  const selectedCount = normalizeRunSelection(selectedIds, runs ?? []).length
  const pageOutOfRange = pageTarget !== null || (page > 1 && !countReady)

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Runs"
        actions={
          <div className="flex items-center gap-2">
            {selectedCount > 0 ? (
              <Button
                variant="danger"
                onClick={() => {
                  deleteRuns.reset()
                  setConfirmBulkDelete(true)
                }}
                disabled={deleteRuns.isPending || remove.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected ({selectedCount})
              </Button>
            ) : null}
            <Button variant="primary" onClick={newRun}>
              <Plus className="h-3.5 w-3.5" />
              New run
            </Button>
          </div>
        }
      />

      <div>
        {pageOutOfRange ? (
          <div className="py-12 text-center text-ui-sm text-tier-quaternary" aria-live="polite">
            Updating run history…
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
        ) : total > 0 && runs && runs.length > 0 ? (
          <>
            <Card className="divide-y divide-[var(--border-quaternary)]">
              <div className={`${ROW_GRID} px-4 py-2 text-ui-sm text-tier-quaternary`}>
                <span>
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={pageSelection.checked}
                    disabled={pageSelection.ids.length === 0 || deleteRuns.isPending}
                    aria-label="Select deletable runs on this page"
                    title={
                      pageSelection.ids.length === 0
                        ? 'No deletable runs on this page'
                        : 'Select all deletable runs on this page'
                    }
                    className="list-selection-checkbox relative z-10 disabled:cursor-not-allowed disabled:opacity-40"
                    onChange={(event) => {
                      event.stopPropagation()
                      const checked = event.currentTarget.checked
                      setSelectedIds((selected) => {
                        const next = new Set(selected)
                        for (const id of pageSelection.ids) {
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
                <span>Chat</span>
                <span className="hidden sm:block">Runtime</span>
                <span className="text-right">Duration</span>
                <span className="text-right">Started</span>
                <span />
              </div>
              {runs.map((r) => {
                const busy = r.status === 'running'
                const pending = remove.isPending
                return (
                  <div
                    key={r.id}
                    className={`group/row relative ${ROW_GRID} px-4 py-1.5 transition-colors hover:bg-hover`}
                  >
                    <Link
                      to="/runs/$runId"
                      params={{ runId: r.id }}
                      viewTransition
                      className="absolute inset-0"
                      aria-label={r.chatTitle}
                    />
                    <span className="relative z-10 flex items-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        disabled={busy || deleteRuns.isPending}
                        aria-label={`Select ${r.chatTitle}`}
                        title={busy ? 'Cancel the run before deleting' : `Select ${r.chatTitle}`}
                        className="list-selection-checkbox disabled:cursor-not-allowed disabled:opacity-40"
                        onChange={(event) => {
                          event.stopPropagation()
                          const checked = event.currentTarget.checked
                          setSelectedIds((selected) => toggleRunSelection(selected, r.id, checked))
                        }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.unread ? (
                        <span
                          role="img"
                          aria-label="Unread messages"
                          title="Unread messages"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block truncate text-ui-base text-foreground"
                        title={r.chatTitle}
                      >
                        {r.chatTitle}
                      </span>
                      {r.activitySummary ? (
                        <span
                          className="block truncate text-ui-sm text-tier-quaternary"
                          title={r.activitySummary}
                        >
                          {r.activitySummary}
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden truncate text-ui-sm text-tier-quaternary sm:block">
                      {r.runtimeLabel}
                    </span>
                    <span
                      className="text-right text-ui-sm tabular-nums text-tier-quaternary"
                      title={
                        r.trigger === 'chat'
                          ? 'Conversations stay open between turns, so elapsed time is not a runtime'
                          : undefined
                      }
                    >
                      {r.trigger === 'chat' ? '—' : duration(r.startedAt, r.finishedAt)}
                    </span>
                    <span
                      className="text-right text-ui-sm tabular-nums text-tier-quaternary"
                      title={absoluteTime(r.startedAt)}
                    >
                      {relativeTime(r.startedAt)}
                    </span>
                    <span className="relative z-10 justify-self-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        disabled={busy || pending}
                        title={busy ? 'Cancel the run before deleting' : 'Delete run'}
                        aria-label={`Delete ${r.chatTitle}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          openDelete(r.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </div>
                )
              })}
            </Card>

            {totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="text-ui-sm tabular-nums text-tier-quaternary">
                  {rangeStart}–{rangeEnd} of {total}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="default"
                    disabled={page <= 1}
                    onClick={() => navigate({ to: '/runs', search: { page: page - 1 } })}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Previous
                  </Button>
                  <span className="px-2 text-ui-sm tabular-nums text-tier-quaternary">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="default"
                    disabled={page >= totalPages}
                    onClick={() => navigate({ to: '/runs', search: { page: page + 1 } })}
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState title="No runs yet">
            Start a chat with an agent, or wait for an automation to fire.
            <div className="mt-3">
              <Button variant="primary" onClick={newRun}>
                <Plus className="h-3.5 w-3.5" /> New run
              </Button>
            </div>
          </EmptyState>
        )}

        {deleteTarget ? (
          <Modal title="Delete run" onClose={closeDelete}>
            <div className="space-y-4">
              <p className="text-ui-base text-tier-secondary">
                Permanently delete <span className="text-foreground">{deleteTarget.chatTitle}</span>
                ? This cannot be undone.
              </p>
              {remove.isError ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger px-3 py-2 text-ui-base text-danger"
                >
                  {remove.error instanceof Error ? remove.error.message : String(remove.error)}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={closeDelete}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void confirmDelete()}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? 'Deleting…' : 'Delete run'}
                </Button>
              </div>
            </div>
          </Modal>
        ) : null}

        {confirmBulkDelete ? (
          <Modal title="Delete selected runs" onClose={closeBulkDelete}>
            <div className="space-y-4">
              <p className="text-ui-base text-tier-secondary">
                Permanently delete{' '}
                <span className="text-foreground">{selectedCount} selected runs</span>? This cannot
                be undone.
              </p>
              {deleteRuns.isError ? (
                <p
                  role="alert"
                  className="rounded-md border border-danger px-3 py-2 text-ui-base text-danger"
                >
                  {deleteRuns.error instanceof Error
                    ? deleteRuns.error.message
                    : String(deleteRuns.error)}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={closeBulkDelete}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void confirmBulk()}
                  disabled={deleteRuns.isPending || selectedCount === 0}
                >
                  {deleteRuns.isPending ? 'Deleting…' : `Delete ${selectedCount} runs`}
                </Button>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
