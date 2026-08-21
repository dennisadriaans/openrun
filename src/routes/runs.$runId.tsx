/**
 * Run detail — conversation workspace.
 *
 * Chat column + bottom terminal drawer + right files/git panel.
 * Panel chrome adapted from t3code ChatView (MIT, T3 Tools Inc.).
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Ban, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as fns from '../fns'
import { Chat, ChatBootSkeleton } from '../components/Chat'
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
  useConversation,
  useCreateWorkspace,
  useDiscard,
  useRemoveRun,
  useRunWorkspace,
  useSendMessage,
} from '../lib/queries'
import { isWorkspaceReady } from '../lib/workspaceReady'
import { useRunLive } from '../lib/useRunLive'

export const Route = createFileRoute('/runs/$runId')({ component: RunDetail })

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
  const { data: workspacePanel } = useRunWorkspace(runId, { streamHealthy })
  const { open: sidebarOpen } = useSidebar()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [reviewPath, setReviewPath] = useState<string | null>(null)
  const [confirmUndoAll, setConfirmUndoAll] = useState(false)
  const [layout, setLayout] = useState<LayoutState>(() => loadLayout(runId))
  const layoutChosenRef = useRef(hasStoredLayout(runId))
  const [newBranchOpen, setNewBranchOpen] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const createWorkspace = useCreateWorkspace()

  const sendMessage = useSendMessage(runId)
  const discard = useDiscard(runId)
  const remove = useRemoveRun()
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    layoutChosenRef.current = hasStoredLayout(runId)
    setLayout(loadLayout(runId))
    setSelectedPath(null)
    setReviewPath(null)
    setConfirmUndoAll(false)
  }, [runId])

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
    if (trigger === 'webhook') patchLayout({ rightPanelOpen: true })
    layoutChosenRef.current = true
  }, [data?.run?.trigger, patchLayout])

  // Keep the workspace chrome mounted while conversation loads — only the
  // chat column waits. "Not found" waits until the first fetch settles.
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
  const canFollowUp = data?.canFollowUp ?? false
  const gh = workspacePanel?.gh ?? { installed: false, authenticated: false }
  const workspace = data?.workspace ?? null
  const project = data?.project ?? null
  const workspaces = data?.workspaces ?? []
  const booting = isLoading || !data

  const cancel = async () => {
    if (!run) return
    qc.setQueryData(['conversation', run.id], (prev: typeof data) =>
      prev ? { ...prev, run: { ...prev.run, status: 'cancelled' as const } } : prev,
    )
    await fns.cancelRun({ data: { id: run.id } })
    qc.invalidateQueries({ queryKey: ['conversation', run.id] })
    qc.invalidateQueries({ queryKey: ['runWorkspace', run.id] })
  }

  const followUpReason =
    run?.status === 'running'
      ? 'The agent is still working — wait for this turn to finish.'
      : 'This runtime has no resumable session, so follow-ups are unavailable.'

  const showRight = layout.rightPanelOpen || layout.maximized
  const showChat = !layout.maximized
  const runBusy = run?.status === 'running'
  const undoFilesReason = runBusy
    ? 'Wait for the agent to finish before undoing changes.'
    : undefined
  const openReview = (path: string) => setReviewPath(path)
  const openReviewAll = () => {
    const first = files[0]
    if (first) setReviewPath(first.path)
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
          <div className="flex min-w-0 flex-1 flex-col">
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
                branchDisabled={booting || sendMessage.isPending || run?.status === 'running'}
                onRequestNewBranch={project ? () => setNewBranchOpen(true) : undefined}
              />

              <div className="flex shrink-0 items-center gap-2">
                {run?.status === 'running' ? (
                  <Button variant="danger" onClick={cancel}>
                    <Ban className="h-4 w-4" /> Cancel
                  </Button>
                ) : null}

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
              {booting ? (
                <ChatBootSkeleton />
              ) : (
                <Chat
                  messages={messages}
                  activePath={selectedPath}
                  canFollowUp={canFollowUp}
                  followUpReason={followUpReason}
                  pending={sendMessage.isPending}
                  running={run!.status === 'running'}
                  checkResults={checkResults}
                  models={data!.models ?? []}
                  runId={runId}
                  runtimeId={data!.runtime?.id}
                  runtimeBin={data!.runtime?.bin}
                  runtimeTransport={data!.runtime?.transport}
                  runTrigger={run!.trigger}
                  installWorkspaceId={workspace?.id ?? run!.workspaceId}
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
                  initialModel={data!.model ?? ''}
                  initialEffort={data!.effort ?? ''}
                  initialRuntimeMode={data!.runtimeMode}
                  changedFiles={files}
                  onSelectFile={(path) => {
                    setSelectedPath(path)
                    patchLayout({ rightPanelOpen: true, maximized: false })
                  }}
                  onReviewFile={openReview}
                  onReviewFiles={openReviewAll}
                  onUndoAllFiles={() => setConfirmUndoAll(true)}
                  undoFilesDisabled={runBusy}
                  undoFilesReason={undoFilesReason}
                  onStop={() => void cancel()}
                  onSend={(input) => sendMessage.mutate(input)}
                  workspaceId={workspace?.id ?? run!.workspaceId}
                  onNewChat={() => navigate({ to: '/runs/new' })}
                />
              )}
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
          onClose={() => setConfirmUndoAll(false)}
          className="z-[110]"
        >
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Restore every file this run changed to the snapshot taken when it started. This cannot
              be undone.
            </p>
            {discard.isError ? (
              <p className="rounded-md border border-border px-3 py-2 text-ui-base text-tier-secondary">
                {discard.error instanceof Error ? discard.error.message : String(discard.error)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setConfirmUndoAll(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={discard.isPending || runBusy}
                onClick={() =>
                  discard.mutate(
                    {},
                    {
                      onSuccess: () => {
                        setConfirmUndoAll(false)
                        setReviewPath(null)
                      },
                    },
                  )
                }
              >
                {discard.isPending ? 'Undoing…' : 'Undo all'}
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
