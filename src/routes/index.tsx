/**
 * Start — the home screen.
 *
 * One centred column for the two ways work begins here: type a message and a
 * run starts (the run-detail composer, same pickers, same resume dropdown), or
 * pick a suggestion and land on a filled-in automation form. Nothing exists
 * server-side until the first message, so this route holds a draft and hands
 * off to `/runs/$runId` once the server answers.
 */
import { createFileRoute } from '@tanstack/react-router'
import { Logo } from './__root'
import { AutomationShortcuts } from '../components/AutomationShortcuts'
import {
  NewRunBreadcrumb,
  NewRunComposer,
  NewRunModals,
  NewRunPendingTurn,
} from '../components/NewRunSurface'
import { Button } from '../components/ui'
import { useNewRunDraft, type NewRunSeed } from '../hooks/useNewRunDraft'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): NewRunSeed => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
    runtimeId: typeof search.runtimeId === 'string' ? search.runtimeId : undefined,
    model: typeof search.model === 'string' ? search.model : undefined,
    effort: typeof search.effort === 'string' ? search.effort : undefined,
  }),
  component: StartPage,
})

function StartPage() {
  const draft = useNewRunDraft(Route.useSearch())
  const noProjects = draft.projects?.length === 0

  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px))] min-h-0 flex-col">
      {draft.sent ? (
        <NewRunPendingTurn sent={draft.sent} />
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 pb-16 pt-[10vh]">
            <div>
              <Logo className="size-5 rounded-[4px]" />
              <h1 className="mt-4 text-ui-xl text-foreground">Let's continue some work</h1>
            </div>

            <div className="space-y-1.5">
              <NewRunComposer
                draft={draft}
                placeholder="Ask anything…"
                className="relative w-full min-w-0"
              />
              <div className="flex min-w-0 px-1">
                <NewRunBreadcrumb draft={draft} compact />
              </div>
            </div>

            {noProjects ? (
              <div className="rounded-xl border border-border bg-elevated/40 px-4 py-3.5">
                <p className="text-ui-base text-foreground">No project yet</p>
                <p className="mt-1 text-ui-sm text-tier-tertiary">
                  Add a repository and Open Run can run agents in it.
                </p>
                <Button
                  variant="primary"
                  className="mt-3"
                  onClick={() => draft.setAddingProject(true)}
                >
                  Add a project
                </Button>
              </div>
            ) : (
              <div className="mt-6">
                <AutomationShortcuts />
              </div>
            )}

            {draft.workspace?.activeRunId ? (
              <p className="px-1 text-ui-sm text-tier-quaternary">
                A chat is already working in this project. You can start another when it finishes.
              </p>
            ) : null}
            {draft.error ? <p className="px-1 text-ui-base text-danger">{draft.error}</p> : null}
          </div>
        </div>
      )}

      <NewRunModals draft={draft} />
    </div>
  )
}
