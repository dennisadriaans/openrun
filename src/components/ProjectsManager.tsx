import { useNavigate } from '@tanstack/react-router'
import {
  ArrowUpRight,
  GitBranch,
  ListChecks,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AddProjectModal } from './AddProjectModal'
import { EffortPicker, ModelPicker, RuntimePicker } from './ComposerControls'
import { Button, Card, EmptyState, Field, Modal, StatusBadge, inputClass } from './ui'
import type { ProjectWithMeta, WorkspaceWithMeta } from '../fns'
import {
  defaultEffort,
  defaultModel,
  findModel,
  modelsForRuntime,
  visibleModels,
} from '../lib/models'
import { DEFAULT_RUNTIME_MODE } from '../lib/runtimeMode'
import { pickerPrefForRuntime, usePickerPrefs } from '../lib/pickerPrefs'
import { pickDefaultRuntime, visibleRuntimes } from '../lib/pickRuntime'
import {
  fetchLatestRunForWorkspace,
  useArchiveWorkspace,
  useProjects,
  useRemoveProject,
  useRetryWorkspaceSetup,
  useRuntimes,
  useStartChat,
  useSuggestProjectChecks,
  useUpdateProject,
  useWorkspaces,
} from '../lib/queries'
import { MAX_CHECKS, parseChecks, type CheckDef } from '../lib/checks'

/**
 * Repository + worktree management. There is no Projects page — this is setup,
 * not a daily destination, so it lives in a modal opened from the one place it
 * matters: picking where an automation runs.
 */
export function ProjectsManager({ onAdded }: { onAdded?: (projectId: string) => void }) {
  const { data: projects = [] } = useProjects()
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setShowAdd(true)}>
          <Plus className="h-3.5 w-3.5" /> New project
        </Button>
      </div>

      {projects.length > 0 ? (
        projects.map((p) => <ProjectSection key={p.id} project={p} />)
      ) : (
        <EmptyState title="No projects">
          Point Open Run at a git repository so agents have somewhere to work.
        </EmptyState>
      )}

      {showAdd ? (
        <AddProjectModal
          onClose={() => setShowAdd(false)}
          onAdded={(project) => onAdded?.(project.id)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Project section — a dashboard-style section per project, workspaces as rows
// ---------------------------------------------------------------------------

export function ManageProjectsModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded?: (projectId: string) => void
}) {
  return (
    <Modal title="Projects" wide onClose={onClose}>
      <ProjectsManager onAdded={onAdded} />
    </Modal>
  )
}

function ProjectSection({ project }: { project: ProjectWithMeta }) {
  const { data: workspaces = [] } = useWorkspaces(project.id)
  const [showDelete, setShowDelete] = useState(false)
  const [showChecks, setShowChecks] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const checkCount = parseChecks(project.checks).length

  const active = workspaces.filter((w) => w.status !== 'archived')

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const menuItem =
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-base text-foreground transition-colors hover:bg-hover'

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="flex min-w-0 items-baseline gap-2 text-ui-base text-tier-secondary">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-foreground">{project.name}</span>
            {/* "Local" is the common case and needs no label; only a missing
                directory — something the user must fix — gets a marker. */}
            {project.managed ? (
              <span className="text-ui-sm text-tier-quaternary">cloned</span>
            ) : null}
            {!project.exists ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-ui-sm text-tier-secondary ring-1 ring-inset ring-border">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                directory is missing
              </span>
            ) : null}
          </span>
        </h2>
        <div className="relative shrink-0" ref={menuRef}>
          <Button
            variant="ghost"
            aria-label={`Actions for ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Project actions"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 z-50 mt-1.5 min-w-48 rounded-xl border border-border bg-elevated p-1.5 shadow-2xl shadow-[var(--shadow-primary)]"
            >
              <button
                type="button"
                role="menuitem"
                className={`${menuItem}${checkCount === 0 ? ' text-warn' : ''}`}
                title={
                  checkCount === 0
                    ? 'No checks — runs in this project can only ever be Unverified'
                    : undefined
                }
                onClick={() => {
                  setMenuOpen(false)
                  setShowChecks(true)
                }}
              >
                <ListChecks className="h-3.5 w-3.5" />
                {checkCount === 0
                  ? 'No checks'
                  : `${checkCount} check${checkCount === 1 ? '' : 's'}`}
              </button>

              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  setShowDelete(true)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete project
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <Card className="divide-y divide-[var(--border-quaternary)]">
        {active.length === 0 ? (
          <div className="px-4 py-10 text-center text-ui-base text-tier-tertiary">
            Project checkout is unavailable. Check the registered folder.
          </div>
        ) : (
          <>
            {active
              .filter((w) => w.kind === 'main')
              .map((w) => (
                <WorkspaceRow key={w.id} workspace={w} />
              ))}
            {active.some((w) => w.kind === 'worktree') ? (
              <details className="px-4 py-3">
                <summary className="cursor-pointer text-ui-sm text-tier-tertiary">
                  Legacy checkouts · recovery
                </summary>
                <p className="my-2 text-ui-sm text-tier-tertiary">
                  Existing folders are preserved. New automation runs manage their own execution
                  directories.
                </p>
                {active
                  .filter((w) => w.kind === 'worktree')
                  .map((w) => (
                    <WorkspaceRow key={w.id} workspace={w} />
                  ))}
              </details>
            ) : null}
          </>
        )}
      </Card>

      {showDelete ? (
        <DeleteProjectModal project={project} onClose={() => setShowDelete(false)} />
      ) : null}
      {showChecks ? (
        <ProjectChecksModal project={project} onClose={() => setShowChecks(false)} />
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Workspace row
// ---------------------------------------------------------------------------

function WorkspaceRow({ workspace: w }: { workspace: WorkspaceWithMeta }) {
  const navigate = useNavigate()
  const retry = useRetryWorkspaceSetup()
  const [showArchive, setShowArchive] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const ready = w.status === 'ready'
  const busy = !!w.activeRunId

  const openExistingOrNew = async () => {
    if (!ready || opening) return
    setOpening(true)
    setOpenError(null)
    try {
      const latest = await fetchLatestRunForWorkspace(w.id)
      if (latest) {
        navigate({ to: '/runs/$runId', params: { runId: latest.id } })
        return
      }
      setShowChat(true)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div>
      <div
        className={`group/ws px-4 py-1.5 transition-colors hover:bg-hover ${
          ready ? 'cursor-pointer' : ''
        } ${opening ? 'opacity-70' : ''}`}
        role={ready ? 'button' : undefined}
        tabIndex={ready ? 0 : undefined}
        aria-label={ready ? `Open chat for ${w.branch}` : undefined}
        onClick={() => void openExistingOrNew()}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void openExistingOrNew()
          }
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="h-3.5 w-3.5 text-tier-quaternary" />
          <span className="mono text-ui-base text-foreground">{w.branch}</span>
          {w.kind === 'main' ? (
            <span
              className="text-ui-sm text-tier-quaternary"
              title="Shared with your editor — diffs include your own uncommitted edits"
            >
              main checkout
            </span>
          ) : null}
          {/* `ready` is the expected resting state and stays silent — a badge on
              every row would make the list uniformly loud. Only non-ready states show. */}
          {w.status !== 'ready' ? <StatusBadge status={w.status} /> : null}
          {w.activeRunId ? <span className="text-ui-sm text-tier-tertiary">in use</span> : null}
          {opening ? <span className="text-ui-sm text-tier-tertiary">Opening…</span> : null}

          <div
            className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/ws:opacity-100 focus-within:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              onClick={() => setShowChat(true)}
              disabled={!ready || busy}
              title={
                busy
                  ? 'Workspace is busy — click the row to open the active chat'
                  : ready
                    ? 'Start a fresh chat'
                    : 'Workspace is not ready'
              }
            >
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
            {w.status === 'error' ? (
              <Button variant="ghost" onClick={() => retry.mutate(w.id)} disabled={retry.isPending}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry setup
              </Button>
            ) : null}
            {w.kind !== 'main' ? (
              <Button variant="ghost" onClick={() => setShowArchive(true)}>
                Archive
              </Button>
            ) : null}
          </div>
        </div>

        {openError ? <p className="mt-1.5 text-ui-sm text-tier-secondary">{openError}</p> : null}

        {retry.isError ? (
          <p className="mt-1.5 text-ui-sm text-tier-secondary">
            {retry.error instanceof Error ? retry.error.message : String(retry.error)}
          </p>
        ) : null}

        {w.status === 'error' && w.setupLog ? (
          <details className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer text-ui-sm text-tier-tertiary hover:text-foreground">
              Setup log{w.setupExitCode != null ? ` (exit ${w.setupExitCode})` : ''}
            </summary>
            <pre className="scroll-thin mt-1.5 max-h-56 overflow-auto rounded-md border border-border bg-[var(--bg-chrome)] p-2.5 mono text-ui-sm whitespace-pre-wrap text-tier-tertiary">
              {w.setupLog}
            </pre>
          </details>
        ) : null}
      </div>

      {showChat ? <StartChatModal workspace={w} onClose={() => setShowChat(false)} /> : null}
      {showArchive ? (
        <ArchiveWorkspaceModal workspace={w} onClose={() => setShowArchive(false)} />
      ) : null}
    </div>
  )
}

function StartChatModal({
  workspace,
  onClose,
}: {
  workspace: WorkspaceWithMeta
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: runtimes } = useRuntimes()
  const start = useStartChat()
  const { prefs, remember } = usePickerPrefs()
  const [runtimeId, setRuntimeId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')

  useEffect(() => {
    if (runtimeId || !runtimes?.length) return
    const preferred = pickDefaultRuntime(
      visibleRuntimes(runtimes, prefs.hiddenRuntimes),
      prefs.runtimeId,
    )
    if (preferred) setRuntimeId(preferred.id)
  }, [runtimes, runtimeId, prefs.runtimeId, prefs.hiddenRuntimes])

  const selectedRuntime = runtimes?.find((r) => r.id === runtimeId)
  const models = useMemo(
    () => (selectedRuntime ? modelsForRuntime(selectedRuntime) : []),
    [selectedRuntime],
  )

  // Seed model/effort from the per-runtime remembered choice, falling back to
  // the catalog default when there's no valid remembered slug.
  useEffect(() => {
    const remembered = pickerPrefForRuntime(prefs, runtimeId)
    const seeded =
      findModel(models, remembered.model) ?? defaultModel(visibleModels(models, prefs.hiddenModels))
    setModel(seeded?.slug ?? '')
    setEffort(remembered.effort || defaultEffort(seeded))
    // Re-seed only when the catalog (i.e. runtime) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, runtimeId])

  const changeRuntime = (id: string) => {
    setRuntimeId(id)
    remember({ runtimeId: id })
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

  const submit = async () => {
    const { runId } = await start.mutateAsync({
      workspaceId: workspace.id,
      runtimeId,
      prompt: prompt.trim(),
      model: model || undefined,
      effort: effort || undefined,
      runtimeMode: DEFAULT_RUNTIME_MODE,
    })
    onClose()
    navigate({ to: '/runs/$runId', params: { runId } })
  }

  return (
    <Modal title={`New chat — ${workspace.branch}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Runtime" hint="which local CLI to use">
          <div className="flex items-center rounded-lg border border-border bg-[var(--bg-luminous-quaternary)] px-2 py-1.5">
            {runtimes && runtimes.length > 0 ? (
              <RuntimePicker
                runtimes={runtimes}
                runtimeId={runtimeId}
                align="start"
                onChange={changeRuntime}
              />
            ) : (
              <span className="px-2.5 text-ui-base text-tier-quaternary">
                No runtimes configured
              </span>
            )}
          </div>
        </Field>

        {models.length > 0 ? (
          <Field label="Model & reasoning">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-[var(--bg-luminous-quaternary)] px-2 py-1.5">
              <ModelPicker models={models} model={model} onChange={changeModel} />
              <EffortPicker models={models} model={model} effort={effort} onChange={changeEffort} />
            </div>
          </Field>
        ) : null}

        <Field label="First message">
          <textarea
            className={`${inputClass} min-h-28 resize-y mono text-[13px]`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should the agent do in this workspace?"
            autoFocus
          />
        </Field>

        {start.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {start.error instanceof Error ? start.error.message : String(start.error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!runtimeId || !prompt.trim() || start.isPending}
          >
            {start.isPending ? 'Starting…' : 'Start chat'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ArchiveWorkspaceModal({
  workspace,
  onClose,
}: {
  workspace: WorkspaceWithMeta
  onClose: () => void
}) {
  const archive = useArchiveWorkspace()
  const [force, setForce] = useState(false)

  const submit = async () => {
    await archive.mutateAsync({ id: workspace.id, force })
    onClose()
  }

  return (
    <Modal title="Archive workspace" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-ui-base text-tier-secondary">
          Archive <span className="mono text-foreground">{workspace.branch}</span>? Its worktree
          will be removed from disk.
        </p>

        {(workspace.dirty || workspace.ahead > 0) && !force ? (
          <div className="rounded-md border border-border px-3 py-2 text-ui-sm text-tier-secondary">
            This workspace has {workspace.dirty ? 'uncommitted changes' : ''}
            {workspace.dirty && workspace.ahead > 0 ? ' and ' : ''}
            {workspace.ahead > 0 ? `${workspace.ahead} unpushed commit(s)` : ''}. Archiving will
            discard them unless you force it.
          </div>
        ) : null}

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--base)]"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          <span className="text-ui-base text-tier-secondary">
            Force — discard uncommitted or unpushed work
          </span>
        </label>

        {archive.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {archive.error instanceof Error ? archive.error.message : String(archive.error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={archive.isPending}>
            {archive.isPending ? 'Archiving…' : 'Archive workspace'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// New workspace modal
// ---------------------------------------------------------------------------

function DeleteProjectModal({
  project,
  onClose,
}: {
  project: ProjectWithMeta
  onClose: () => void
}) {
  const remove = useRemoveProject()
  const [deleteFiles, setDeleteFiles] = useState(false)

  const submit = async () => {
    await remove.mutateAsync({ id: project.id, deleteFiles: project.managed === 1 && deleteFiles })
    onClose()
  }

  return (
    <Modal title="Delete project" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-ui-base text-tier-secondary">
          Delete <span className="text-foreground">{project.name}</span>? All its non-archived
          workspaces will be removed. This cannot be undone.
        </p>

        {project.managed === 1 ? (
          <label className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--base)]"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
            />
            <span className="text-ui-base text-tier-secondary">
              Also delete the cloned files from disk
              <span className="ml-1.5 text-ui-sm text-tier-quaternary">({project.path})</span>
            </span>
          </label>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 text-ui-sm text-tier-quaternary">
            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This is a local repo you registered — its directory is left untouched.
          </div>
        )}

        {remove.isError ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
            {remove.error instanceof Error ? remove.error.message : String(remove.error)}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Verification checks
// ---------------------------------------------------------------------------

function blankCheck(): CheckDef {
  return {
    id: `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    command: '',
  }
}

/**
 * Editor for a project's "definition of done".
 *
 * These commands run in the worktree after an automation's turn and decide
 * whether a run comes back Verified or Checks failed — without them a run can
 * only ever report that the CLI exited 0, which it does even when the code does
 * not compile. They never run on a turn you typed yourself.
 */
function ProjectChecksModal({
  project,
  onClose,
}: {
  project: ProjectWithMeta
  onClose: () => void
}) {
  const [checks, setChecks] = useState<CheckDef[]>(() => parseChecks(project.checks))
  const [error, setError] = useState('')
  const save = useUpdateProject()
  const suggest = useSuggestProjectChecks()

  const patch = (index: number, partial: Partial<CheckDef>) => {
    setChecks((prev) => prev.map((c, i) => (i === index ? { ...c, ...partial } : c)))
  }

  const move = (index: number, delta: number) => {
    setChecks((prev) => {
      const next = prev.slice()
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const submit = async () => {
    setError('')
    // Drop rows the user added and left blank rather than failing the save on
    // them — an empty trailing row is a UI artefact, not an intent.
    const cleaned = checks.filter((c) => c.command.trim().length > 0)
    try {
      await save.mutateAsync({ id: project.id, checks: cleaned })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const applySuggestion = async () => {
    setError('')
    try {
      const suggested = await suggest.mutateAsync(project.id)
      if (suggested.length === 0) {
        setError('No package.json scripts recognised in this repo — add checks by hand.')
        return
      }
      setChecks(suggested)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={`Checks — ${project.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-ui-base text-tier-secondary">
          Commands run in the worktree after an automation's turn, in order, stopping at the first
          failure. A failing check makes the run <span className="text-danger">Checks failed</span>{' '}
          and is what the automation hands back to the agent to repair. Chatting with a run never
          triggers them.
        </p>

        <div className="space-y-2">
          {checks.map((check, i) => (
            <div key={check.id} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 gap-2">
                  <input
                    className={`${inputClass} max-w-[180px]`}
                    placeholder="Name (e.g. Types)"
                    value={check.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                  <input
                    className={`${inputClass} mono`}
                    placeholder="pnpm typecheck"
                    value={check.command}
                    onChange={(e) => patch(i, { command: e.target.value })}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    variant="ghost"
                    disabled={i === 0}
                    title="Run earlier"
                    aria-label={`Move ${check.name || check.command} earlier`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={i === checks.length - 1}
                    title="Run later"
                    aria-label={`Move ${check.name || check.command} later`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    title="Remove check"
                    aria-label={`Remove ${check.name || check.command}`}
                    onClick={() => setChecks((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {checks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-ui-base text-tier-tertiary">
              No checks yet — every run in this project reports{' '}
              <span className="text-foreground">Unverified</span>.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            disabled={checks.length >= MAX_CHECKS}
            title={checks.length >= MAX_CHECKS ? `At most ${MAX_CHECKS} checks` : undefined}
            onClick={() => setChecks((prev) => [...prev, blankCheck()])}
          >
            <Plus className="h-3.5 w-3.5" /> Add check
          </Button>
          <Button variant="ghost" disabled={suggest.isPending} onClick={applySuggestion}>
            <Wand2 className="h-3.5 w-3.5" />
            {suggest.isPending ? 'Reading package.json…' : 'Suggest from package.json'}
          </Button>
        </div>

        {error ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save checks'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
