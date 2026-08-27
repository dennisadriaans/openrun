/**
 * Run detail — conversation workspace.
 *
 * Chat column + bottom terminal drawer + right files/git panel.
 * Panel chrome adapted from t3code ChatView (MIT, T3 Tools Inc.).
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Ban, ChevronDown, ChevronRight, Plus, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as fns from '../fns'
import { Chat } from '../components/Chat'
import { ChatDebugToggle } from '../components/chat/ChatDebugToggle'
import { ContextMeter } from '../components/chat/ContextMeter'
import { TerminalPalettePicker } from '../components/chat/TerminalPalettePicker'
import { useChatTheme } from '../components/chat/ChatThemeProvider'
import { DiffPanel } from '../components/DiffPanel'
import { EmptyState, Modal } from '../components/ui'
import { Button } from '../components/ui'
import { RightPanelToggleControl } from '../components/workspace/PanelLayoutControls'
import { RightPanel } from '../components/workspace/RightPanel'
import { TerminalDrawer } from '../components/workspace/TerminalDrawer'
import { VerticalResizeHandle } from '../components/workspace/VerticalResizeHandle'
import { SidebarToggle, useSidebar } from '../components/AppChrome'
import { WorkspaceBreadcrumb } from '../components/workspace/WorkspaceBreadcrumb'
import {
  peekCachedRunSummary,
  prefetchConversation,
  RUN_PRELOAD_STALE_MS,
  scheduleIdleWorkspacePrefetch,
  useConversation,
  useCreateWorkspace,
  useDiscard,
  useRemoveRun,
  useRuntimes,
  useRunWorkspace,
  useStartChat,
  useSendMessage,
} from '../lib/queries'
import { defaultEffort, defaultModel, modelsForRuntime } from '../lib/models'
import type { RuntimeMode } from '../lib/runtimeMode'
import { isWorkspaceReady } from '../lib/workspaceReady'
import {
  NO_RUN_COMMITS,
  shortSha,
  undoCommitsBlockedReason,
  undoCommitsLabel,
} from '../lib/undoRun'
import { isDemoDetailRun, isDemoMode } from '../lib/demoData.ts'
import { useRunLive } from '../lib/useRunLive'

export const Route = createFileRoute('/runs/$runId')({
  loader: ({ context, params }) => {
    void prefetchConversation(context.queryClient, params.runId)
  },
  preloadStaleTime: RUN_PRELOAD_STALE_MS,
  component: RunDetail,
})

const DEFAULT_RIGHT_PANEL_WIDTH = 420
const MIN_RIGHT_PANEL_WIDTH = 280
const MAX_RIGHT_PANEL_WIDTH = 800

type LayoutState = {
  terminalOpen: boolean
  rightPanelOpen: boolean
  maximized: boolean
  terminalHeight: number
  rightPanelWidth: number
}

function layoutStorageKey(runId: string) {
  return `agentops:layout:${runId}`
}

function defaultLayout(): LayoutState {
  return {
    terminalOpen: false,
    rightPanelOpen: false,
    maximized: false,
    terminalHeight: 220,
    rightPanelWidth: DEFAULT_RIGHT_PANEL_WIDTH,
  }
}

function hasStoredLayout(runId: string): boolean {
  try {
    return sessionStorage.getItem(layoutStorageKey(runId)) != null
  } catch {
    return false
  }
}

function loadLayout(runId: string): LayoutState {
  const fallback = defaultLayout()
  try {
    const raw = sessionStorage.getItem(layoutStorageKey(runId))
    if (!raw) return fallback
    const parsed = { ...fallback, ...JSON.parse(raw) } as LayoutState
    parsed.rightPanelWidth = Math.min(
      MAX_RIGHT_PANEL_WIDTH,
      Math.max(MIN_RIGHT_PANEL_WIDTH, Number(parsed.rightPanelWidth) || DEFAULT_RIGHT_PANEL_WIDTH),
    )
    return parsed
  } catch {
    return fallback
  }
}

function RunDetail() {
  const { runId } = Route.useParams()
  const { streamHealthy } = useRunLive(runId)
  const { data, isLoading } = useConversation(runId, { streamHealthy })
  const { data: runtimes } = useRuntimes()
  const { open: sidebarOpen } = useSidebar()
  const debug = useChatTheme().theme === 'terminal'
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [reviewPath, setReviewPath] = useState<string | null>(null)
  const [confirmUndoAll, setConfirmUndoAll] = useState(false)
  const [dropCommits, setDropCommits] = useState(false)
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout(runId))
  const layoutChosenRef = useRef(hasStoredLayout(runId))
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newRunMenuOpen, setNewRunMenuOpen] = useState(false)
  const newRunMenuRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const listRow = peekCachedRunSummary(qc, runId)
  const navigate = useNavigate()
  const createWorkspace = useCreateWorkspace()
  const showRight = layout.rightPanelOpen || layout.maximized
  // The undo dialog reads this run's commits, and it opens from the chat's
  // diff overlay too — where the right panel may well be closed.
  const { data: workspacePanel } = useRunWorkspace(runId, {
    streamHealthy,
    enabled: showRight || confirmUndoAll,
  })

  const sendMessage = useSendMessage(runId)
  const startNewRun = useStartChat()
  const discard = useDiscard(runId)
  const remove = useRemoveRun()
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (showRight) return
    return scheduleIdleWorkspacePrefetch(qc, runId)
  }, [qc, runId, showRight])

  useEffect(() => {
    layoutChosenRef.current = hasStoredLayout(runId)
    setLayout(loadLayout(runId))
    setSelectedPath(null)
    setReviewPath(null)
    setConfirmUndoAll(false)
  }, [runId])

  useEffect(() => {
    if (!newRunMenuOpen) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!newRunMenuRef.current?.contains(event.target as Node)) setNewRunMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNewRunMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [newRunMenuOpen])

  const patchLayout = useCallback((partial: Partial<LayoutState>) => {
    layoutChosenRef.current = true
    setLayout((prev) => ({ ...prev, ...partial }))
  }, [])

  useEffect(() => {
    if (!layoutChosenRef.current) return
    try {
      sessionStorage.setItem(layoutStorageKey(runId), JSON.stringify(layout))
    } catch {
      // ignore quota / private mode
    }
  }, [runId, layout])

  useEffect(() => {
    if (!reviewPath) return
    const currentFiles = workspacePanel?.files ?? []
    if (currentFiles.length === 0) {
      setReviewPath(null)
      return
    }
    if (!currentFiles.some((file) => file.path === reviewPath)) {
      setReviewPath(currentFiles[0]?.path ?? null)
    }
  }, [workspacePanel?.files, reviewPath])

  useEffect(() => {
    const trigger = data?.run?.trigger
    if (!trigger) return
    if (layoutChosenRef.current) return
    if (trigger === 'webhook' || (isDemoMode() && isDemoDetailRun(runId))) {
      patchLayout({ rightPanelOpen: true })
    }
    layoutChosenRef.current = true
  }, [data?.run?.trigger, patchLayout, runId])

  const openReview = useCallback((path: string) => setReviewPath(path), [])
  const firstChangedPath = workspacePanel?.files[0]?.path
  const openReviewAll = useCallback(() => {
    if (firstChangedPath) setReviewPath(firstChangedPath)
  }, [firstChangedPath])
  const onSelectFile = useCallback(
    (path: string) => {
      setSelectedPath(path)
      patchLayout({ rightPanelOpen: true, maximized: false })
    },
    [patchLayout],
  )
  const onUndoAllFiles = useCallback(() => setConfirmUndoAll(true), [])
  const sendFollowUp = sendMessage.mutate
  const onSend = useCallback(
    (input: {
      prompt: string
      model: string
      effort: string
      runtimeMode: RuntimeMode
      runtimeId?: string
    }) => {
      sendFollowUp(input)
    },
    [sendFollowUp],
  )
  const onNewChat = useCallback(() => {
    void navigate({
      to: '/runs/new',
      search: {
        projectId: data?.project?.id,
        workspaceId: data?.workspace?.id,
        runtimeId: data?.runtime?.id,
        model: data?.model || undefined,
        effort: data?.effort || undefined,
        runtimeMode: data?.runtimeMode,
      },
    })
  }, [data, navigate])
  const onStop = useCallback(() => {
    const current = data?.run
    if (!current) return
    qc.setQueryData(['conversation', current.id], (prev: typeof data) =>
      prev ? { ...prev, run: { ...prev.run, status: 'cancelled' as const } } : prev,
    )
    void fns.cancelRun({ data: { id: current.id } }).then(() => {
      void qc.invalidateQueries({ queryKey: ['conversation', current.id] })
      void qc.invalidateQueries({ queryKey: ['runWorkspace', current.id] })
    })
  }, [data, qc])

  // Keep the workspace chrome mounted while conversation loads — only the
  // transcript waits. "Not found" waits until the first fetch settles.
  if (!isLoading && !data) {
    return (
      <div className="px-8 py-8">
        <EmptyState title="Run not found">
          <Link
            to="/runs"
            className="text-tier-secondary underline underline-offset-2 hover:text-foreground"
          >
            Back to run history
          </Link>
        </EmptyState>
      </div>
    )
  }

  const run = data?.run
  const messages = data?.messages ?? []
  // The newest turn that reported any: context is a property of the session,
  // so it survives a turn that said nothing about itself.
  const contextUsage = [...messages].reverse().find((m) => m.usage)?.usage ?? null
  const files = workspacePanel?.files ?? []
  const repo = workspacePanel?.repo ?? {
    isRepo: false,
    branch: '',
    head: '',
    remote: '',
    hasUpstream: false,
    ahead: 0,
    dirty: false,
  }
  const totals = workspacePanel?.totals ?? { additions: 0, deletions: 0 }
  const checkResults = data?.checkResults ?? []
  const canFollowUp = data?.canFollowUp ?? listRow?.status !== 'running'
  const gh = workspacePanel?.gh ?? { installed: false, authenticated: false }
  const runCommits = workspacePanel?.commits ?? NO_RUN_COMMITS
  const commitsBlockedReason = undoCommitsBlockedReason(runCommits)
  const canDropCommits = commitsBlockedReason === null
  const workspace = data?.workspace ?? null
  const project = data?.project ?? null
  const workspaces = data?.workspaces ?? []
  const booting = isLoading || !data
  const fallbackRuntime = runtimes?.find(
    (runtime) => runtime.id === (data?.runtime?.id ?? listRow?.runtimeId),
  )
  const models = data?.models?.length
    ? data.models
    : fallbackRuntime
      ? modelsForRuntime(fallbackRuntime)
      : []
  const seededModel = data?.model || defaultModel(models)?.slug || ''
  const seededEffort = data?.effort || defaultEffort(defaultModel(models))

  const followUpReason =
    (run?.status ?? listRow?.status) === 'running'
      ? 'The agent is still working — wait for this turn to finish.'
      : 'This runtime has no resumable session, so follow-ups are unavailable.'

  const showChat = !layout.maximized
  const runBusy = run?.status === 'running'
  const undoFilesReason = runBusy
    ? 'Wait for the agent to finish before undoing changes.'
    : undefined

  const newRunRuntimeId = data?.runtime?.id ?? fallbackRuntime?.id
  const firstPrompt = messages.find((message) => message.role === 'user')?.content.trim() ?? ''
  const newRunBlockedReason = !run
    ? 'Loading run details'
    : runBusy
      ? 'Wait for the current run to finish'
      : !workspace?.id
        ? 'This run has no workspace to reuse'
        : !newRunRuntimeId
          ? 'The run runtime is unavailable'
          : !firstPrompt
            ? 'This run has no prompt to repeat'
            : null
  const canStartNewRun = newRunBlockedReason === null && !startNewRun.isPending
  const startNewRunMutate = startNewRun.mutate
  const onNewRun = () => {
    if (!run || !workspace?.id || !newRunRuntimeId || !firstPrompt || runBusy) return
    startNewRunMutate(
      {
        workspaceId: workspace.id,
        runtimeId: newRunRuntimeId,
        prompt: firstPrompt,
        model: data?.model ?? run.model,
        effort: data?.effort ?? run.effort,
        runtimeMode: data?.runtimeMode ?? run.runtimeMode,
      },
      {
        onSuccess: ({ runId: newRunId }) =>
          void navigate({ to: '/runs/$runId', params: { runId: newRunId } }),
      },
    )
    setNewRunMenuOpen(false)
  }

  const submitNewBranch = async () => {
    if (!project || !newBranchName.trim()) return
    await createWorkspace.mutateAsync({
      projectId: project.id,
      branch: newBranchName.trim(),
    })
    setNewBranchOpen(false)
    setNewBranchName('')
  }

  return (
    <div className="flex h-[calc(100vh-var(--header-h,0px))] min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {showChat ? (
          <div className="flex min-w-0 flex-1 flex-col" style={{ viewTransitionName: 'run-chat' }}>
            {/*
              The top bar lives inside the chat column (t3code layout) so the
              right panel is a full-height sibling rather than sitting below it.
            */}
            <header className="flex h-[var(--workspace-topbar-height,44px)] shrink-0 items-center gap-2 border-b border-border px-3">
              {!sidebarOpen ? <SidebarToggle /> : null}
              <Link
                to="/runs"
                className="flex shrink-0 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground"
                title="Back to run history"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>

              <WorkspaceBreadcrumb
                projectName={project?.name}
                branch={workspace?.branch}
                isMainCheckout={workspace?.kind === 'main'}
                workspace={workspace}
                workspaces={workspaces}
                branchDisabled={booting || run?.status === 'running'}
                onRequestNewBranch={project ? () => setNewBranchOpen(true) : undefined}
              />

              <ContextMeter usage={contextUsage} />

              <div className="flex shrink-0 items-center gap-2">
                <div ref={newRunMenuRef} className="relative flex">
                  <Button
                    variant="primary"
                    onClick={onNewChat}
                    disabled={!run}
                    title="Start an empty chat with the same settings"
                    className="rounded-r-none pr-2.5"
                  >
                    <Plus className="h-4 w-4" />
                    New chat
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!run}
                    aria-label="New run options"
                    aria-haspopup="menu"
                    aria-expanded={newRunMenuOpen}
                    onClick={() => setNewRunMenuOpen((open) => !open)}
                    className="rounded-l-none border-l border-l-black/15 px-1.5"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                  {newRunMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-1.5 min-w-48 rounded-xl border border-border bg-elevated p-1.5 shadow-2xl shadow-[var(--shadow-primary)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground transition-colors hover:bg-hover"
                        onClick={() => {
                          setNewRunMenuOpen(false)
                          onNewChat()
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" /> New chat
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!canStartNewRun}
                        title={
                          newRunBlockedReason ?? 'Repeat the first prompt with the same settings'
                        }
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui-sm text-foreground transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        onClick={onNewRun}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {startNewRun.isPending ? 'Starting…' : 'Repeat run'}
                      </button>
                    </div>
                  ) : null}
                </div>
                {startNewRun.isError ? (
                  <span
                    role="alert"
                    className="max-w-48 truncate text-ui-sm text-danger"
                    title={
                      startNewRun.error instanceof Error
                        ? startNewRun.error.message
                        : String(startNewRun.error)
                    }
                  >
                    Could not start run
                  </span>
                ) : null}
                {run?.status === 'running' ? (
                  <Button variant="danger" onClick={onStop}>
                    <Ban className="h-4 w-4" /> Cancel
                  </Button>
                ) : null}

                {debug ? <TerminalPalettePicker /> : null}
                <ChatDebugToggle />

                {/*
                  The layout controls live in the right panel. Only the reopen
                  affordance falls back here, so the panel is never stranded shut.
                */}
                {!showRight ? (
                  <div className="flex items-center gap-0.5 border-l border-border pl-2">
                    <RightPanelToggleControl
                      rightPanelOpen={false}
                      onToggle={() => patchLayout({ rightPanelOpen: true, maximized: false })}
                    />
                  </div>
                ) : null}
              </div>
            </header>

            <div className="min-h-0 flex-1">
              <Chat
                messages={messages}
                transcriptPending={booting}
                activePath={selectedPath}
                canFollowUp={canFollowUp}
                followUpReason={followUpReason}
                pending={false}
                running={run?.status === 'running'}
                checkResults={checkResults}
                models={models}
                runId={runId}
                runtimeId={data?.runtime?.id ?? fallbackRuntime?.id}
                runtimeBin={data?.runtime?.bin ?? fallbackRuntime?.bin}
                runtimeTransport={data?.runtime?.transport ?? fallbackRuntime?.transport}
                runtimes={runtimes ?? []}
                canSwitchRuntime={data?.canSwitchRuntime ?? false}
                runTrigger={run?.trigger}
                installWorkspaceId={workspace?.id ?? run?.workspaceId}
                installWorkspaceReady={workspace ? isWorkspaceReady(workspace.status) : false}
                installWorkspaceStatus={workspace?.status}
                installProjectId={project?.id ?? workspace?.projectId}
                installProjectName={project?.name}
                installWorkspaceLabel={
                  workspace
                    ? workspace.kind === 'main'
                      ? 'main'
                      : workspace.branch || workspace.id
                    : null
                }
                initialModel={seededModel}
                initialEffort={seededEffort}
                initialRuntimeMode={data?.runtimeMode}
                changedFiles={files}
                onSelectFile={onSelectFile}
                onReviewFile={openReview}
                onReviewFiles={openReviewAll}
                onUndoAllFiles={onUndoAllFiles}
                undoFilesDisabled={runBusy}
                undoFilesReason={undoFilesReason}
                onStop={onStop}
                onSend={onSend}
                workspaceId={workspace?.id ?? run?.workspaceId}
                onNewChat={onNewChat}
              />
            </div>
          </div>
        ) : null}

        {showRight ? (
          <div
            className={`relative flex min-h-0 shrink-0 flex-col border-l border-border ${
              layout.maximized ? 'flex-1' : ''
            }`}
            style={layout.maximized ? undefined : { width: layout.rightPanelWidth }}
          >
            {!layout.maximized ? (
              <VerticalResizeHandle
                width={layout.rightPanelWidth}
                onWidthChange={(rightPanelWidth) => patchLayout({ rightPanelWidth })}
                min={MIN_RIGHT_PANEL_WIDTH}
                max={MAX_RIGHT_PANEL_WIDTH}
              />
            ) : null}
            <RightPanel
              runId={runId}
              files={files}
              checkResults={checkResults}
              currentMessageId={
                [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? ''
              }
              runBusy={run?.status === 'running'}
              selectedPath={selectedPath}
              onSelectPath={setSelectedPath}
              onReviewFile={openReview}
              onUndoAllFiles={() => setConfirmUndoAll(true)}
              reviewPath={reviewPath}
              undoDisabled={runBusy}
              undoDisabledReason={undoFilesReason}
              terminalOpen={layout.terminalOpen}
              onToggleTerminal={() => patchLayout({ terminalOpen: !layout.terminalOpen })}
              onToggleRightPanel={() => patchLayout({ rightPanelOpen: false, maximized: false })}
              maximized={layout.maximized}
              onToggleMaximized={() =>
                patchLayout({ maximized: !layout.maximized, rightPanelOpen: true })
              }
              git={{
                runId,
                repo,
                fileCount: files.length,
                totals,
                taskName: workspacePanel?.taskName ?? run?.taskName ?? '',
                gh,
                baseBranch: workspacePanel?.baseBranch ?? run?.baseBranch ?? '',
              }}
            />
          </div>
        ) : null}
      </div>

      {reviewPath ? (
        <DiffPanel
          variant="overlay"
          runId={runId}
          files={files}
          path={reviewPath}
          discardDisabled={runBusy}
          discardDisabledReason={undoFilesReason}
          onClose={() => setReviewPath(null)}
          onSelect={setReviewPath}
          onDiscardAll={() => setConfirmUndoAll(true)}
        />
      ) : null}

      {confirmUndoAll ? (
        <Modal
          title="Undo all changes"
          onClose={() => {
            setConfirmUndoAll(false)
            setDropCommits(false)
          }}
          className="z-[110]"
        >
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Restore every file this run changed to the snapshot taken when it started. This cannot
              be undone.
            </p>

            {runCommits.commits.length > 0 ? (
              <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
                <label className="flex items-start gap-2 text-ui-base text-tier-secondary">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={dropCommits && canDropCommits}
                    disabled={!canDropCommits}
                    onChange={(e) => setDropCommits(e.target.checked)}
                  />
                  <span>
                    {undoCommitsLabel(runCommits)}
                    <span className="block text-ui-sm text-tier-tertiary">
                      Without this the files go back but the commits stay on the branch, so
                      <code className="mono"> git log </code>
                      still shows them.
                    </span>
                  </span>
                </label>

                <ul className="space-y-0.5 pl-6 text-ui-sm text-tier-tertiary">
                  {runCommits.commits.slice(0, 5).map((commit) => (
                    <li key={commit.sha} className="truncate">
                      <span className="mono">{shortSha(commit.sha)}</span> {commit.subject}
                    </li>
                  ))}
                  {runCommits.commits.length > 5 ? (
                    <li>+{runCommits.commits.length - 5} more</li>
                  ) : null}
                </ul>

                {commitsBlockedReason ? (
                  <p className="text-ui-sm text-amber-300">{commitsBlockedReason}</p>
                ) : dropCommits ? (
                  <p className="text-ui-sm text-tier-tertiary">
                    The branch moves back to {shortSha(runCommits.baseCommit)}. The dropped commits
                    stay in your reflog.
                  </p>
                ) : null}
              </div>
            ) : null}

            {discard.isError ? (
              <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
                {discard.error instanceof Error ? discard.error.message : String(discard.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmUndoAll(false)
                  setDropCommits(false)
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={discard.isPending || runBusy}
                onClick={() =>
                  discard.mutate(
                    { resetCommits: dropCommits && canDropCommits },
                    {
                      onSuccess: () => {
                        setConfirmUndoAll(false)
                        setDropCommits(false)
                        setReviewPath(null)
                      },
                    },
                  )
                }
              >
                {discard.isPending
                  ? 'Undoing…'
                  : dropCommits && canDropCommits
                    ? 'Undo all and drop commits'
                    : 'Undo all'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/*
        Spans the full workspace width rather than the chat column, so the
        terminal toggle still works while the right panel is maximized.
      */}
      <TerminalDrawer
        open={layout.terminalOpen}
        height={layout.terminalHeight}
        onHeightChange={(terminalHeight) => patchLayout({ terminalHeight })}
        command={run?.command ?? ''}
        stdout={run?.stdout ?? ''}
        stderr={run?.stderr ?? ''}
      />

      {newBranchOpen && project ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-elevated p-5 shadow-2xl">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-foreground">
              <ChevronRight className="size-4 opacity-0" />
              New branch workspace
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Creates a worktree under {project.name}. Start a chat from Projects when it is ready.
            </p>
            <input
              autoFocus
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="feature/my-branch"
              className="mb-4 w-full rounded-lg border border-border bg-chrome px-3 py-2 mono text-sm outline-none focus:border-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewBranch()
                if (e.key === 'Escape') setNewBranchOpen(false)
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNewBranchOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!newBranchName.trim() || createWorkspace.isPending}
                onClick={() => void submitNewBranch()}
              >
                {createWorkspace.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete && run ? (
        <Modal title="Delete run" onClose={() => setConfirmDelete(false)}>
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Permanently delete <span className="text-foreground">{run.taskName}</span>? This
              cannot be undone.
            </p>
            {remove.isError ? (
              <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
                {remove.error instanceof Error ? remove.error.message : String(remove.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(run.id)
                  navigate({ to: '/runs' })
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Delete run'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}
