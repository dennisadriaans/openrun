/**
 * Everything a not-yet-started run needs: project, branch, runtime, model, the
 * chat it resumes, and the first message that actually creates it.
 *
 * This is the container half of the start surfaces — `/` and `/runs/new` render
 * the same pickers around it, so the wiring lives here once and the components
 * that read it stay presentational.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  defaultEffort,
  defaultModel,
  findModel,
  modelsForRuntime,
  visibleModels,
} from '../lib/models'
import {
  nativeResumeKindFor,
  type NativeSession,
  type NativeSessionGroup,
} from '../lib/nativeSessions'
import { supportsTranscriptImport } from '../lib/nativeTranscript'
import { pickDefaultRuntime, visibleRuntimes } from '../lib/pickRuntime'
import { pickerPrefForRuntime, usePickerPrefs } from '../lib/pickerPrefs'
import {
  attachmentUploader,
  useCreateWorkspace,
  useNativeSessions,
  useOpenNativeChat,
  usePlugins,
  useProjectBranches,
  useProjects,
  useRuntimes,
  useSlashCommands,
  useStartChat,
  useWorkspaces,
} from '../lib/queries'
import { DEFAULT_RUNTIME_MODE } from '../lib/runtimeMode'
import { isWorkspaceReady } from '../lib/workspaceReady'

/** Search params both start routes accept, so a hand-off keeps its selection. */
export type NewRunSeed = {
  projectId?: string
  workspaceId?: string
  runtimeId?: string
  model?: string
  effort?: string
}

export type NewRunDraft = ReturnType<typeof useNewRunDraft>

export function useNewRunDraft(
  seed: NewRunSeed = {},
  options: { allNativeSessions?: boolean } = {},
) {
  const navigate = useNavigate()
  const { prefs, remember } = usePickerPrefs()
  const { data: projects } = useProjects()
  const { data: runtimes } = useRuntimes()
  const startChat = useStartChat()
  const openNativeChat = useOpenNativeChat()
  const createWorkspace = useCreateWorkspace()

  const [projectId, setProjectId] = useState(seed.projectId ?? '')
  const [workspaceId, setWorkspaceId] = useState(seed.workspaceId ?? '')
  const [runtimeId, setRuntimeId] = useState(seed.runtimeId ?? '')
  const [resumeSessionId, setResumeSessionId] = useState('')
  const [resumeSessionLabel, setResumeSessionLabel] = useState('')
  const [model, setModel] = useState(seed.model ?? '')
  const [effort, setEffort] = useState(seed.effort ?? '')
  const [error, setError] = useState<string | null>(null)
  // Optimistic first turn: the run only exists once the server answers, so the
  // transcript is faked here to cover the boot round-trip.
  const [sent, setSent] = useState<{ prompt: string; startedAt: number } | null>(null)
  const [addingProject, setAddingProject] = useState(false)
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const { data: allWorkspaces } = useWorkspaces(projectId || undefined)
  const { data: gitBranches } = useProjectBranches(projectId || undefined)
  const nativeQuery = useNativeSessions(
    options.allNativeSessions ? { allWorkspaces: true } : { workspaceId },
    { enabled: options.allNativeSessions || Boolean(workspaceId) },
  )
  // File commands only: `/clear` and friends need a conversation to act on.
  const { data: commands } = useSlashCommands(
    { runtimeId, ...(workspaceId ? { workspaceId } : {}) },
    { enabled: !!runtimeId },
  )
  const { data: pluginListing } = usePlugins(
    { runtimeId, ...(workspaceId ? { workspaceId } : {}) },
    { enabled: !!runtimeId },
  )

  const project = projects?.find((row) => row.id === projectId)
  const workspaces = useMemo(
    () => (allWorkspaces ?? []).filter((w) => w.status !== 'archived'),
    [allWorkspaces],
  )

  useEffect(() => {
    if (projectId || !projects?.length) return
    setProjectId(projects[0]!.id)
  }, [projects, projectId])

  // Seed / re-seed the branch whenever the project's workspaces change.
  useEffect(() => {
    if (workspaces.some((w) => w.id === workspaceId)) return
    const preferred =
      workspaces.find(
        (w) => w.kind === 'worktree' && isWorkspaceReady(w.status) && !w.activeRunId,
      ) ?? workspaces.find((w) => isWorkspaceReady(w.status) && !w.activeRunId)
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
      findModel(models, runtimeId === seed.runtimeId ? seed.model : undefined) ??
      findModel(models, remembered.model) ??
      defaultModel(visibleModels(models, prefs.hiddenModels))
    setModel(seeded?.slug ?? '')
    setEffort(
      (runtimeId === seed.runtimeId && seeded?.slug === seed.model ? seed.effort : undefined) ||
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

  const selectProject = (id: string) => {
    setProjectId(id)
    setWorkspaceId('')
  }

  const selectBranch = (id: string) => {
    setWorkspaceError(null)
    setWorkspaceId(id)
  }

  const clearResume = () => {
    setResumeSessionId('')
    setResumeSessionLabel('')
  }

  const selectRuntime = (id: string) => {
    setRuntimeId(id)
    const previousKind = nativeResumeKindFor(runtime ?? {})
    const nextKind = nativeResumeKindFor(runtimes?.find((row) => row.id === id) ?? {})
    if (!nextKind || nextKind !== previousKind) clearResume()
    remember({ runtimeId: id })
  }

  const openNewWorkspace = () => {
    setWorkspaceError(null)
    setNewWorkspaceOpen(true)
  }

  const createBranch = async (input: { branch: string; fromBranch?: string }) => {
    const created = await createWorkspace.mutateAsync({ projectId, ...input })
    setWorkspaceId(created.id)
    setNewWorkspaceOpen(false)
  }

  /**
   * Picking a saved chat opens it as its own run: the transcript is imported
   * and shown, and nothing is prompted until the composer there is used. CLIs
   * we cannot read a transcript for keep the old behaviour — the chat is armed
   * here and adopted by the first message.
   */
  const pickNativeSession = (session: NativeSession, group: NativeSessionGroup) => {
    const targetWorkspaceId = session.workspaceId ?? readyWorkspaceId
    if (session.projectId) setProjectId(session.projectId)
    if (session.workspaceId) setWorkspaceId(session.workspaceId)
    setRuntimeId(group.runtimeId)
    remember({ runtimeId: group.runtimeId })
    if (!targetWorkspaceId || !supportsTranscriptImport(group.kind)) {
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
        workspaceId: targetWorkspaceId,
        runtimeId: group.runtimeId,
        sessionId: session.sessionId,
        sessionLabel: session.title,
        ...(sameRuntime ? { model, effort } : {}),
        runtimeMode: DEFAULT_RUNTIME_MODE,
      },
      {
        onSuccess: ({ runId }) => navigate({ to: '/runs/$runId', params: { runId } }),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const changeModel = (slug: string) => {
    setModel(slug)
    const nextEffort = defaultEffort(findModel(models, slug))
    setEffort(nextEffort)
    remember({ forRuntimeId: runtimeId, model: slug, effort: nextEffort })
  }

  const changeEffort = (value: string) => {
    setEffort(value)
    remember({ forRuntimeId: runtimeId, effort: value })
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
        runtimeMode: DEFAULT_RUNTIME_MODE,
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

  return {
    projects,
    project,
    projectId,
    workspaces,
    workspace,
    workspaceId,
    gitBranches,
    runtimes,
    runtime,
    runtimeId,
    models,
    model,
    effort,
    commands,
    pluginListing,
    uploadAttachment,
    nativeQuery,
    allNativeSessions: Boolean(options.allNativeSessions),
    resumeSessionId,
    resumeSessionLabel,
    blockedReason,
    error,
    workspaceError,
    sent,
    busy: startChat.isPending || openNativeChat.isPending,
    startChat,
    openNativeChat,
    createWorkspace,
    addingProject,
    setAddingProject,
    newWorkspaceOpen,
    setNewWorkspaceOpen,
    openNewWorkspace,
    createBranch,
    selectProject,
    selectBranch,
    selectRuntime,
    clearResume,
    pickNativeSession,
    changeModel,
    changeEffort,
    send,
  }
}
