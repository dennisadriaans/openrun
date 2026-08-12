import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  StatusBadge,
  VerdictBadge,
} from '../components/ui'
import { absoluteTime, duration, relativeTime } from '../lib/format'
import { useRemoveRun, useRuns } from '../lib/queries'

export const Route = createFileRoute('/runs/')({ component: RunsPage })

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_4rem_4.5rem_1.75rem] sm:grid-cols-[6.5rem_minmax(0,1fr)_8rem_5.5rem_4rem_4.5rem_1.75rem]'

function RunsPage() {
  const { data: runs, isLoading } = useRuns()
  const remove = useRemoveRun()
  const navigate = useNavigate()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const deleteTarget = runs?.find((r) => r.id === deleteId)

  const newRun = () => navigate({ to: '/runs/new' })

  const confirmDelete = async () => {
    if (!deleteId) return
    await remove.mutateAsync(deleteId)
    setDeleteId(null)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <PageHeader
        title="Runs"
        actions={
          <Button variant="primary" onClick={newRun}>
            <Plus className="h-3.5 w-3.5" />
            New run
          </Button>
        }
      />

      <div>
        {isLoading ? (
          <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
        ) : runs && runs.length > 0 ? (
          <Card className="divide-y divide-[var(--border-quaternary)]">
            <div className={`${ROW_GRID} px-4 py-2 text-ui-sm text-tier-quaternary`}>
              <span>Status</span>
              <span>Run</span>
              <span className="hidden sm:block">Runtime</span>
              <span>Verdict</span>
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
                  className={`group/row relative ${ROW_GRID} px-4 py-2 transition-colors hover:bg-hover`}
                >
                  <Link
                    to="/runs/$runId"
                    params={{ runId: r.id }}
                    className="absolute inset-0"
                    aria-label={r.taskName}
                  />
                  <StatusBadge status={r.status} />
                  <span className="truncate text-ui-base text-foreground">{r.taskName}</span>
                  <span className="hidden truncate text-ui-sm text-tier-quaternary sm:block">
                    {r.runtimeLabel}
                  </span>
                  <span className="truncate">
                    <VerdictBadge verdict={r.verdict} />
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
                  <span className="relative justify-self-end opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      disabled={busy || pending}
                      title={busy ? 'Cancel the run before deleting' : 'Delete run'}
                      aria-label={`Delete ${r.taskName}`}
                      onClick={() => setDeleteId(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </div>
              )
            })}
          </Card>
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
          <Modal title="Delete run" onClose={() => setDeleteId(null)}>
            <div className="space-y-4">
              <p className="text-ui-base text-tier-secondary">
                Permanently delete <span className="text-foreground">{deleteTarget.taskName}</span>?
                This cannot be undone.
              </p>
              {remove.isError ? (
                <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
                  {remove.error instanceof Error ? remove.error.message : String(remove.error)}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setDeleteId(null)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDelete} disabled={remove.isPending}>
                  {remove.isPending ? 'Deleting…' : 'Delete run'}
                </Button>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
