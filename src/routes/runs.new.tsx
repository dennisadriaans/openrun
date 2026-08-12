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
import { defaultEffort, defaultModel, findModel, modelsForBin } from '../lib/models'
import { pickDefaultRuntime } from '../lib/pickRuntime'
import { pickerPrefForRuntime, usePickerPrefs } from '../lib/pickerPrefs'
import { useProjects, useRuntimes, useStartChat, useWorkspaces } from '../lib/queries'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from '../lib/runtimeMode'
import { supportsSupervised } from '../lib/supervisedPolicy'
import { isWorkspaceReady } from '../lib/workspaceReady'

export const Route = createFileRoute('/runs/new')({ component: NewRun })

function NewRun() {
  const navigate = useNavigate()
  const { open: sidebarOpen } = useSidebar()
  const { prefs, remember } = usePickerPrefs()
  const { data: projects } = useProjects()
  const { data: runtimes } = useRuntimes()
  const startChat = useStartChat()

  const [projectId, setProjectId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    parseRuntimeMode(prefs.runtimeMode ?? DEFAULT_RUNTIME_MODE),
  )
  const [error, setError] = useState<string | null>(null)
  const [addingProject, setAddingProject] = useState(false)

  const { data: allWorkspaces } = useWorkspaces(projectId || undefined)
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
      workspaces.find((w) => isWorkspaceReady(w.status) && !w.activeRunId) ?? workspaces[0]
    setWorkspaceId(preferred?.id ?? '')
  }, [workspaces, workspaceId])

  useEffect(() => {
    if (runtimeId || !runtimes?.length) return
    const preferred = pickDefaultRuntime(runtimes, prefs.runtimeId)
    if (preferred) setRuntimeId(preferred.id)
  }, [runtimes, runtimeId, prefs.runtimeId])

  const runtime = runtimes?.find((r) => r.id === runtimeId)
  const models = useMemo(() => (runtime ? modelsForBin(runtime.bin) : []), [runtime])

  useEffect(() => {
    const remembered = pickerPrefForRuntime(prefs, runtimeId)
    const seeded = findModel(models, remembered.model) ?? defaultModel(models)
    setModel(seeded?.slug ?? '')
    setEffort(remembered.effort || defaultEffort(seeded))
    // Re-seed only when the catalog (i.e. runtime) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, runtimeId])

  const workspace = workspaces.find((w) => w.id === workspaceId)
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

  const send = (prompt: string) => {
    if (!workspace || !runtime) return
    setError(null)
    startChat.mutate(
      { workspaceId: workspace.id, runtimeId: runtime.id, prompt, model, effort, runtimeMode },
      {
        onSuccess: ({ runId }) => navigate({ to: '/runs/$runId', params: { runId } }),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
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
            workspaces={workspaces.map((w) => ({
              id: w.id,
              branch: w.branch,
              kind: w.kind,
              status: w.status,
              blockedReason: !isWorkspaceReady(w.status)
                ? w.status
                : w.activeRunId
                  ? 'run active'
                  : null,
            }))}
            workspaceId={workspaceId}
            disabled={startChat.isPending}
            onChange={setWorkspaceId}
          />
        </nav>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 pb-40">
          <div className="max-w-md text-center">
            <h1 className="text-ui-lg text-foreground">Start a new run</h1>
            <p className="mt-1.5 text-ui-base text-tier-tertiary">
              Confirm the project and branch above, pick a runtime, then send the first message. The
              run appears in history the moment the agent starts.
            </p>
            {error ? <p className="mt-3 text-ui-base text-danger">{error}</p> : null}
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2">
          <div className="chat-composer-horizontal-inset pointer-events-auto relative z-10 isolate">
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
    </div>
  )
}
