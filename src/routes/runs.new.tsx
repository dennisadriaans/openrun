/**
 * New run — an empty conversation.
 *
 * Nothing exists server-side yet: project/branch sit in the top bar (the same
 * slot the run detail breadcrumb uses, so nothing moves once the run starts),
 * runtime/model stay in the composer, and the first message is what actually
 * starts the run. On success we hand off to the real run detail route. The
 * draft and the pickers are shared with the start page (`routes/index.tsx`).
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { SidebarToggle, useSidebar } from '../components/AppChrome'
import {
  NewRunBreadcrumb,
  NewRunComposer,
  NewRunModals,
  NewRunPendingTurn,
} from '../components/NewRunSurface'
import { Button } from '../components/ui'
import { useNewRunDraft, type NewRunSeed } from '../hooks/useNewRunDraft'

export const Route = createFileRoute('/runs/new')({
  validateSearch: (search: Record<string, unknown>): NewRunSeed => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
    runtimeId: typeof search.runtimeId === 'string' ? search.runtimeId : undefined,
    model: typeof search.model === 'string' ? search.model : undefined,
    effort: typeof search.effort === 'string' ? search.effort : undefined,
  }),
  component: NewRun,
})

function NewRun() {
  const draft = useNewRunDraft(Route.useSearch())
  const navigate = useNavigate()
  const { open: sidebarOpen } = useSidebar()

  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px))] min-h-0 flex-col">
      <header className="flex h-[var(--workspace-topbar-height,44px)] shrink-0 items-center gap-2 border-b border-border px-3">
        {!sidebarOpen ? <SidebarToggle /> : null}
        <Link
          to="/runs"
          className="flex shrink-0 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground"
          title="Back to run history"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <NewRunBreadcrumb draft={draft} />
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {draft.sent ? (
          <NewRunPendingTurn sent={draft.sent} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 pb-40">
            <div className="max-w-md text-center">
              <h1 className="text-ui-lg text-foreground">Start a new run</h1>
              <p className="mt-1.5 text-ui-base text-tier-tertiary">
                Confirm the project and branch above, pick a runtime, then send the first message.
              </p>
              {draft.workspace?.activeRunId ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    onClick={draft.openNewWorkspace}
                    disabled={draft.createWorkspace.isPending}
                  >
                    Create isolated workspace
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void navigate({
                        to: '/runs/$runId',
                        params: { runId: draft.workspace!.activeRunId! },
                      })
                    }
                  >
                    Open active run
                  </Button>
                </div>
              ) : null}
              {draft.error ? <p className="mt-3 text-ui-base text-danger">{draft.error}</p> : null}
              {draft.workspaceError ? (
                <p className="mt-3 text-ui-base text-danger">{draft.workspaceError}</p>
              ) : null}
            </div>
          </div>
        )}

        <div className="chat-composer-dock pointer-events-none absolute inset-x-0 bottom-0 z-20">
          <div className="chat-composer-horizontal-inset pointer-events-auto relative z-10">
            <NewRunComposer draft={draft} />
            <div className="chat-composer-lower-chrome relative z-10 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]" />
          </div>
        </div>
      </div>

      <NewRunModals draft={draft} />
    </div>
  )
}
