/**
 * The pickers a run is started from, wired to `useNewRunDraft`.
 *
 * `/` and `/runs/new` lay these out differently but drive the same draft, so
 * the composer, the breadcrumb and the two modals live here rather than being
 * copied into both routes.
 */
import { AddProjectModal } from './AddProjectModal'
import { Composer } from './chat/Composer'
import { WorkingIndicator } from './chat/WorkingIndicator'
import { RuntimePicker } from './ComposerControls'
import { NewWorkspaceModal } from './NewWorkspaceModal'
import { WorkspaceBreadcrumb } from './workspace/WorkspaceBreadcrumb'
import type { NewRunDraft } from '../hooks/useNewRunDraft'

export function NewRunBreadcrumb({ draft }: { draft: NewRunDraft }) {
  return (
    <WorkspaceBreadcrumb
      projectId={draft.projectId}
      projectName={draft.project?.name}
      workspace={draft.workspace}
      workspaces={draft.workspaces}
      branchDisabled={draft.startChat.isPending || draft.createWorkspace.isPending}
      onAddProject={() => draft.setAddingProject(true)}
      onSelectProject={draft.selectProject}
      onSelectWorkspace={draft.selectBranch}
      onRequestNewBranch={draft.projectId ? draft.openNewWorkspace : undefined}
    />
  )
}

export function NewRunComposer({
  draft,
  placeholder,
  className,
}: {
  draft: NewRunDraft
  placeholder?: string
  /** Overrides the docked width/padding — the start page renders it inline. */
  className?: string
}) {
  return (
    <Composer
      {...(className ? { className } : {})}
      disabled={draft.blockedReason !== null}
      disabledReason={draft.blockedReason ?? undefined}
      placeholder={placeholder ?? 'Describe the first task…'}
      pending={draft.startChat.isPending}
      running={false}
      models={draft.models}
      model={draft.model}
      effort={draft.effort}
      leading={
        <div className="flex min-w-0 shrink items-center gap-0.5">
          <RuntimePicker
            runtimes={draft.runtimes ?? []}
            runtimeId={draft.runtimeId}
            disabled={draft.startChat.isPending}
            align="start"
            sessions={{
              workspaceId: draft.workspaceId,
              allWorkspaces: draft.allNativeSessions,
              groups:
                draft.workspaceId || draft.allNativeSessions
                  ? (draft.nativeQuery.data?.groups ?? [])
                  : [],
              resumeSessionId: draft.resumeSessionId,
              resumeSessionLabel: draft.resumeSessionLabel,
              onOpen: () => draft.nativeQuery.refetch(),
              onSelectNew: draft.clearResume,
              onSelect: draft.pickNativeSession,
            }}
            onChange={draft.selectRuntime}
          />
        </div>
      }
      onModelChange={draft.changeModel}
      onEffortChange={draft.changeEffort}
      onSend={draft.send}
      {...(draft.refusedPrompt ? { restoredDraft: draft.refusedPrompt } : {})}
      {...(draft.uploadAttachment ? { uploadAttachment: draft.uploadAttachment } : {})}
      commands={draft.commands?.commands ?? []}
      {...(draft.commands?.note ? { commandNote: draft.commands.note } : {})}
      plugins={draft.pluginListing?.plugins ?? []}
      {...(draft.pluginListing?.note ? { pluginNote: draft.pluginListing.note } : {})}
    />
  )
}

/** Optimistic first turn, shown while the server boots the real run. */
export function NewRunPendingTurn({ sent }: { sent: { prompt: string; startedAt: number } }) {
  return (
    <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-5">
      <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4 pb-40 pt-3 sm:pt-4">
        <div className="flex flex-col items-end gap-1">
          <div className="max-w-[80%] rounded-[10px] border border-border bg-secondary px-3 py-2">
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {sent.prompt}
            </div>
          </div>
        </div>
        <div className="px-1">
          <WorkingIndicator verb="Starting" orb="breathing" startedAt={sent.startedAt} />
        </div>
      </div>
    </div>
  )
}

export function NewRunModals({ draft }: { draft: NewRunDraft }) {
  return (
    <>
      {draft.addingProject ? (
        <AddProjectModal
          onClose={() => draft.setAddingProject(false)}
          onAdded={(project) => draft.selectProject(project.id)}
        />
      ) : null}

      {draft.newWorkspaceOpen && draft.project ? (
        <NewWorkspaceModal
          projectName={draft.project.name}
          defaultBaseBranch={draft.project.defaultBranch || ''}
          baseBranches={draft.gitBranches ?? []}
          pending={draft.createWorkspace.isPending}
          onClose={() => draft.setNewWorkspaceOpen(false)}
          onCreate={draft.createBranch}
        />
      ) : null}
    </>
  )
}
