/**
 * New run — an empty conversation.
 *
 * Nothing exists server-side yet: project/branch sit in the top bar (the same
 * slot the run detail breadcrumb uses, so nothing moves once the run starts),
 * runtime/model stay in the composer, and the first message is what actually
 * starts the run. On success we hand off to the real run detail route.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Composer } from '../components/Chat'
import { BranchPicker, ProjectPicker, RuntimePicker } from '../components/ComposerControls'
import { AddProjectModal } from '../components/AddProjectModal'
import { SidebarToggle, useSidebar } from '../components/AppChrome'
import { WorkingIndicator } from '../components/chat/WorkingIndicator'
import { NativeSessionMenu } from '../components/NativeSessionMenu'
import { Button, Field, inputClass, Modal } from '../components/ui'
import { parsePendingGitBranchId, projectBranchChoices } from '../lib/gitBranches'
import {
  defaultEffort,
  defaultModel,
  findModel,
  modelsForRuntime,
  visibleModels,
} from '../lib/models'
import { pickDefaultRuntime, visibleRuntimes } from '../lib/pickRuntime'
import { pickerPrefForRuntime, usePickerPrefs } from '../lib/pickerPrefs'
import {
  nativeResumeKindFor,
  type NativeSession,
  type NativeSessionGroup,
} from '../lib/nativeSessions'
import { supportsTranscriptImport } from '../lib/nativeTranscript'
import {
  attachmentUploader,
  useNativeSessions,
  useCreateWorkspace,
  useOpenNativeChat,
  useProjectBranches,
  useProjects,
  useRuntimes,
  usePlugins,
  useSlashCommands,
  useStartChat,
  useWorkspaces,
} from '../lib/queries'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from '../lib/runtimeMode'
import { supportsSupervised } from '../lib/supervisedPolicy'
import { isWorkspaceReady } from '../lib/workspaceReady'

type NewRunSearch = {
  projectId?: string
  workspaceId?: string
  runtimeId?: string
  model?: string
  effort?: string
  runtimeMode?: string
}

export const Route = createFileRoute('/runs/new')({
  validateSearch: (search: Record<string, unknown>): NewRunSearch => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
    workspaceId: typeof search.workspaceId === 'string' ? search.workspaceId : undefined,
    runtimeId: typeof search.runtimeId === 'string' ? search.runtimeId : undefined,
    model: typeof search.model === 'string' ? search.model : undefined,
    effort: typeof search.effort === 'string' ? search.effort : undefined,
    runtimeMode: typeof search.runtimeMode === 'string' ? search.runtimeMode : undefined,
  }),
  component: NewRun,
})

function NewRun() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const { open: sidebarOpen } = useSidebar()
  const { prefs, remember } = usePickerPrefs()
  const { data: projects } = useProjects()
  const { data: runtimes } = useRuntimes()
  const startChat = useStartChat()
  const openNativeChat = useOpenNativeChat()
  const createWorkspace = useCreateWorkspace()

  const [projectId, setProjectId] = useState(search.projectId ?? '')
  const [workspaceId, setWorkspaceId] = useState(search.workspaceId ?? '')
  const [runtimeId, setRuntimeId] = useState(search.runtimeId ?? '')
  const [resumeSessionId, setResumeSessionId] = useState('')
  const [resumeSessionLabel, setResumeSessionLabel] = useState('')
  // File commands only: `/clear` and friends need a conversation to act on.
  const { data: commands } = useSlashCommands(
    { runtimeId, ...(workspaceId ? { workspaceId } : {}) },
    { enabled: !!runtimeId },
  )
  const { data: pluginListing } = usePlugins(
    { runtimeId, ...(workspaceId ? { workspaceId } : {}) },
    { enabled: !!runtimeId },
  )
  const [model, setModel] = useState(search.model ?? '')
  const [effort, setEffort] = useState(search.effort ?? '')
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    parseRuntimeMode(search.runtimeMode ?? prefs.runtimeMode ?? DEFAULT_RUNTIME_MODE),
  )
  const [error, setError] = useState<string | null>(null)
  // Optimistic first turn: the run only exists once the server answers, so the
  // transcript is faked here to cover the boot round-trip.
  const [sent, setSent] = useState<{ prompt: string; startedAt: number } | null>(null)
  const [addingProject, setAddingProject] = useState(false)
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [baseBranch, setBaseBranch] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const { data: allWorkspaces } = useWorkspaces(projectId || undefined)
  const { data: gitBranches } = useProjectBranches(projectId || undefined)
  const nativeQuery = useNativeSessions({ workspaceId }, { enabled: Boolean(workspaceId) })
  const workspaces = useMemo(
    () => (allWorkspaces ?? []).filter((w) => w.status !== 'archived'),
    [allWorkspaces],
  )
  const project = projects?.find((row) => row.id === projectId)
  const branchChoices = useMemo(
    () =>
      projectBranchChoices({
        gitBranches: gitBranches ?? [],
        workspaces: workspaces.map((w) => ({
          id: w.id,
          branch: w.branch,
          kind: w.kind,
          status: w.status,
          activeRunId: w.activeRunId,
        })),
      }),
    [gitBranches, workspaces],
  )

  useEffect(() => {
    if (projectId || !projects?.length) return
    setProjectId(projects[0]!.id)
  }, [projects, projectId])

  // Seed / re-seed the branch whenever the project's workspaces change.
  useEffect(() => {
    if (workspaces.some((w) => w.id === workspaceId)) return
    const preferred =
      workspaces.find((w) => isWorkspaceReady(w.status) && !w.activeRunId) ?? workspaces[0]
    setWorkspaceId(preferred?.id ?? '')
  }, [workspaces, workspaceId])

  useEffect(() => {
    setResumeSessionId('')
    setResumeSessionLabel('')
  }, [workspaceId])

  useEffect(() => {
    if (runtimeId || !runtimes?.length) return
    const preferred = pickDefaultRuntime(
      visibleRuntimes(runtimes, prefs.hiddenRuntimes),
      prefs.runtimeId,
    )
    if (preferred) setRuntimeId(preferred.id)
  }, [runtimes, runtimeId, prefs.runtimeId, prefs.hiddenRuntimes])

  const runtime = runtimes?.find((r) => r.id === runtimeId)
  const models = useMemo(() => (runtime ? modelsForRuntime(runtime) : []), [runtime])

  useEffect(() => {
    const remembered = pickerPrefForRuntime(prefs, runtimeId)
    const seeded =
      findModel(models, runtimeId === search.runtimeId ? search.model : undefined) ??
      findModel(models, remembered.model) ??
      defaultModel(visibleModels(models, prefs.hiddenModels))
    setModel(seeded?.slug ?? '')
    setEffort(
      (runtimeId === search.runtimeId && seeded?.slug === search.model
        ? search.effort
        : undefined) ||
        remembered.effort ||
        defaultEffort(seeded),
    )
    // Re-seed only when the catalog (i.e. runtime) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, runtimeId])

  const workspace = workspaces.find((w) => w.id === workspaceId)
  const readyWorkspaceId =
    workspace && isWorkspaceReady(workspace.status) ? workspace.id : undefined
  const uploadAttachment = useMemo(() => attachmentUploader(readyWorkspaceId), [readyWorkspaceId])
  const blockedReason = !projects?.length
    ? 'Add a project before starting a run.'
    : !workspace
      ? 'Pick a branch to run in.'
      : !isWorkspaceReady(workspace.status)
        ? `Branch is ${workspace.status} — wait for setup to finish.`
        : workspace.activeRunId
          ? 'A run is already active in this branch.'
          : !runtime
            ? 'Pick a runtime.'
            : null

  const selectBranch = async (id: string) => {
    setWorkspaceError(null)
    const pending = parsePendingGitBranchId(id)
    if (!pending) {
      setWorkspaceId(id)
      return
    }
    if (!projectId) return
    const gitRow = (gitBranches ?? []).find((row) => row.name === pending)
    try {
      const created = await createWorkspace.mutateAsync({
        projectId,
        branch: pending,
        fromBranch: pending,
        useExistingBranch: gitRow ? !gitRow.remote : true,
      })
      setWorkspaceId(created.id)
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  const openNewWorkspace = () => {
    setWorkspaceError(null)
    setNewBranchName('')
    setBaseBranch(workspace?.branch || project?.defaultBranch || '')
    setNewWorkspaceOpen(true)
  }

  const submitNewWorkspace = async () => {
    if (!projectId || !newBranchName.trim()) return
    setWorkspaceError(null)
    try {
      const created = await createWorkspace.mutateAsync({
        projectId,
        branch: newBranchName.trim(),
        fromBranch: baseBranch.trim() || undefined,
      })
      setWorkspaceId(created.id)
      setNewWorkspaceOpen(false)
      setNewBranchName('')
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * Picking a saved chat opens it as its own run: the transcript is imported
   * and shown, and nothing is prompted until the composer there is used. CLIs
   * we cannot read a transcript for keep the old behaviour — the chat is armed
   * here and adopted by the first message.
   */
  const pickNativeSession = (session: NativeSession, group: NativeSessionGroup) => {
    setRuntimeId(group.runtimeId)
    remember({ runtimeId: group.runtimeId })
    if (!readyWorkspaceId || !supportsTranscriptImport(group.kind)) {
      setResumeSessionId(session.sessionId)
      setResumeSessionLabel(session.title)
      return
    }
    setError(null)
    // The composer's model belongs to the runtime it was picked for; a chat from
    // another CLI takes that runtime's defaults instead.
    const sameRuntime = group.runtimeId === runtimeId
    openNativeChat.mutate(
      {
        workspaceId: readyWorkspaceId,
        runtimeId: group.runtimeId,
        sessionId: session.sessionId,
        sessionLabel: session.title,
        ...(sameRuntime ? { model, effort } : {}),
        runtimeMode,
      },
      {
        onSuccess: ({ runId }) => navigate({ to: '/runs/$runId', params: { runId } }),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const send = (prompt: string) => {
    if (!workspace || !runtime || sent) return
    setError(null)
    setSent({ prompt, startedAt: Date.now() })
    startChat.mutate(
      {
        workspaceId: workspace.id,
        runtimeId: runtime.id,
        prompt,
        model,
        effort,
        runtimeMode,
        resumeSessionId,
        resumeSessionLabel,
      },
      {
        onSuccess: ({ runId }) => navigate({ to: '/runs/$runId', params: { runId } }),
        onError: (err) => {
          setSent(null)
          setError(err instanceof Error ? err.message : String(err))
        },
      },
    )
  }

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
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-0.5">
          <ProjectPicker
            projects={projects ?? []}
            projectId={projectId}
            disabled={startChat.isPending}
            onChange={(id) => {
              setProjectId(id)
              setWorkspaceId('')
            }}
            onAddProject={() => setAddingProject(true)}
          />
          <span aria-hidden className="shrink-0 text-muted-foreground/40">
            /
          </span>
          <BranchPicker
            workspaces={branchChoices}
            workspaceId={workspaceId}
            disabled={startChat.isPending || createWorkspace.isPending}
            newBranchLabel="New branch and workspace"
            onChange={(id) => void selectBranch(id)}
            onRequestNewBranch={projectId ? openNewWorkspace : undefined}
          />
          {!sent ? (
            <>
              <span aria-hidden className="shrink-0 text-muted-foreground/40">
                /
              </span>
              <NativeSessionMenu
                workspaceId={workspaceId}
                groups={nativeQuery.data?.groups ?? []}
                loading={nativeQuery.isFetching}
                error={nativeQuery.data?.error}
                selectedId={resumeSessionId}
                selectedLabel={resumeSessionLabel}
                onOpen={() => nativeQuery.refetch()}
                disabled={!workspaceId || startChat.isPending || openNativeChat.isPending}
                disabledReason="Pick a branch first"
                onSelectNew={() => {
                  setResumeSessionId('')
                  setResumeSessionLabel('')
                }}
                onSelect={pickNativeSession}
              />
            </>
          ) : null}
        </nav>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {sent ? (
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
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 pb-40">
            <div className="max-w-md text-center">
              <h1 className="text-ui-lg text-foreground">Start a new run</h1>
              <p className="mt-1.5 text-ui-base text-tier-tertiary">
                Confirm the project and branch above, pick a runtime, then send the first message.
              </p>
              {workspace?.activeRunId ? (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    variant="primary"
                    onClick={openNewWorkspace}
                    disabled={createWorkspace.isPending}
                  >
                    Create isolated workspace
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void navigate({
                        to: '/runs/$runId',
                        params: { runId: workspace.activeRunId! },
                      })
                    }
                  >
                    Open active run
                  </Button>
                </div>
              ) : null}
              {error ? <p className="mt-3 text-ui-base text-danger">{error}</p> : null}
              {workspaceError ? (
                <p className="mt-3 text-ui-base text-danger">{workspaceError}</p>
              ) : null}
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2">
          <div className="chat-composer-horizontal-inset pointer-events-auto relative z-10">
            <Composer
              disabled={blockedReason !== null}
              disabledReason={blockedReason ?? undefined}
              placeholder="Describe the first task…"
              pending={startChat.isPending}
              running={false}
              models={models}
              model={model}
              effort={effort}
              runtimeMode={runtimeMode}
              supportsSupervised={supportsSupervised({
                bin: runtime?.bin,
                transport: runtime?.transport,
              })}
              leading={
                <div className="flex min-w-0 shrink items-center gap-0.5">
                  <RuntimePicker
                    runtimes={runtimes ?? []}
                    runtimeId={runtimeId}
                    disabled={startChat.isPending}
                    align="start"
                    onChange={(id) => {
                      setRuntimeId(id)
                      const previousKind = nativeResumeKindFor(runtime ?? {})
                      const nextKind = nativeResumeKindFor(
                        runtimes?.find((row) => row.id === id) ?? {},
                      )
                      if (!nextKind || nextKind !== previousKind) {
                        setResumeSessionId('')
                        setResumeSessionLabel('')
                      }
                      remember({ runtimeId: id })
                    }}
                  />
                </div>
              }
              onModelChange={(slug) => {
                setModel(slug)
                const nextEffort = defaultEffort(findModel(models, slug))
                setEffort(nextEffort)
                remember({ forRuntimeId: runtimeId, model: slug, effort: nextEffort })
              }}
              onEffortChange={(value) => {
                setEffort(value)
                remember({ forRuntimeId: runtimeId, effort: value })
              }}
              onRuntimeModeChange={(mode) => {
                setRuntimeMode(mode)
                remember({ runtimeMode: mode })
              }}
              onSend={send}
              {...(uploadAttachment ? { uploadAttachment } : {})}
              commands={commands?.commands ?? []}
              {...(commands?.note ? { commandNote: commands.note } : {})}
              plugins={pluginListing?.plugins ?? []}
              {...(pluginListing?.note ? { pluginNote: pluginListing.note } : {})}
            />
            <div className="chat-composer-lower-chrome relative z-10 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-[calc(env(safe-area-inset-bottom)+1rem)]" />
          </div>
        </div>
      </div>

      {addingProject ? (
        <AddProjectModal
          onClose={() => setAddingProject(false)}
          onAdded={(project) => {
            setProjectId(project.id)
            setWorkspaceId('')
          }}
        />
      ) : null}

      {newWorkspaceOpen && project ? (
        <Modal title={`New workspace — ${project.name}`} onClose={() => setNewWorkspaceOpen(false)}>
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Creates a separate Git worktree so this run can work in parallel with other sessions.
            </p>
            <Field label="New branch">
              <input
                autoFocus
                className={`${inputClass} mono text-[13px]`}
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
                placeholder="feature/my-change"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitNewWorkspace()
                }}
              />
            </Field>
            <Field label="Base branch" hint="only committed Git state is copied">
              <input
                className={`${inputClass} mono text-[13px]`}
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
              />
            </Field>
            {workspaceError ? <p className="text-ui-base text-danger">{workspaceError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNewWorkspaceOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!newBranchName.trim() || createWorkspace.isPending}
                onClick={() => void submitNewWorkspace()}
              >
                {createWorkspace.isPending ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
