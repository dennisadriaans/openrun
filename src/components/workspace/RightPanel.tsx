import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { FolderTree, GitCompare, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { DiffPanel } from '../DiffPanel'
import { ChecksPanel } from '../ChecksPanel'
import { FilesChanged } from '../FilesChanged'
import { GitActionsMenu, type GitActionsProps } from '../GitActions'
import { FileTree } from './FileTree'
import {
  RightPanelMaximizeControl,
  RightPanelToggleControl,
  WorkspaceToolbarChip,
} from './PanelLayoutControls'

// CodeMirror is ~600KB; keep it out of the workspace chunk so it only loads
// once a file is actually opened for editing.
const FileEditor = lazy(() => import('./FileEditor').then((m) => ({ default: m.FileEditor })))
import type { DiffFile } from '../../server/git'
import type { CachedCheckResult } from '../../lib/applyRunLiveEvent'
import { countFailingChecks } from '../../lib/checkPass'

/** Which source the panel is showing: changed-only, verification checks, or the whole tree. */
type FilesView = 'changed' | 'checks' | 'browse'

export function RightPanel({
  runId,
  files,
  checkResults,
  currentMessageId,
  runBusy,
  selectedPath,
  onSelectPath,
  onReviewFile,
  onUndoAllFiles,
  reviewPath,
  undoDisabled = false,
  undoDisabledReason,
  terminalOpen: _terminalOpen,
  onToggleTerminal: _onToggleTerminal,
  onToggleRightPanel,
  maximized = false,
  onToggleMaximized,
  git,
}: {
  runId: string
  files: DiffFile[]
  /** Verification results for this run; empty when the project has no checks. */
  checkResults: CachedCheckResult[]
  /** Newest assistant message, so the Checks tab can tell a stale pass apart. */
  currentMessageId: string
  runBusy: boolean
  selectedPath: string | null
  onSelectPath: (path: string | null) => void
  onReviewFile: (path: string) => void
  onUndoAllFiles: () => void
  reviewPath: string | null
  undoDisabled?: boolean
  undoDisabledReason?: string
  terminalOpen: boolean
  onToggleTerminal: () => void
  onToggleRightPanel: () => void
  /** True when the panel has taken over the full workspace width. */
  maximized?: boolean
  onToggleMaximized: () => void
  git: GitActionsProps
}) {
  const [filesView, setFilesView] = useState<FilesView>('changed')
  // Path opened for editing from the browse tree, kept separate from
  // `selectedPath` so opening a diff and editing a file don't fight.
  const [editingPath, setEditingPath] = useState<string | null>(null)
  // Held here, not in FileTree: the tree unmounts while the editor is open, so
  // closing a file would otherwise drop the reader back at a collapsed root.
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set())
  // Survives closing the editor, so the tree still marks where the reader was.
  const [lastBrowsedPath, setLastBrowsedPath] = useState<string | null>(null)
  const changedPaths = useMemo(() => new Set(files.map((f) => f.path)), [files])

  const toggleDir = useCallback((dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (!next.delete(dir)) next.add(dir)
      return next
    })
  }, [])

  const viewChanges = () => {
    setFilesView('changed')
    setEditingPath(null)
    onSelectPath(null)
  }

  // The layout controls live here rather than in the chat header, so they stay
  // reachable while the panel is maximized and the chat column is unmounted.
  const layoutControls = (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* <TerminalToggleControl terminalOpen={terminalOpen} onToggle={onToggleTerminal} /> */}
      <RightPanelMaximizeControl maximized={maximized} onToggle={onToggleMaximized} />
      <RightPanelToggleControl rightPanelOpen onToggle={onToggleRightPanel} />
    </div>
  )

  // Exactly one tab is active: a file diff counts as Changed, an editor as Browse.
  const activeTab: FilesView = editingPath ? 'browse' : selectedPath ? 'changed' : filesView
  const changedActive = activeTab === 'changed'
  const checksActive = activeTab === 'checks'
  const browseActive = activeTab === 'browse'

  const failingChecks = useMemo(() => countFailingChecks(checkResults), [checkResults])

  const tabBar = (
    <div className="flex h-[var(--workspace-topbar-height,44px)] shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
      {git.repo.isRepo ? (
        <GitActionsMenu
          {...git}
          menuAlign="left"
          onViewChanges={viewChanges}
          trigger={{
            label: 'Changed',
            icon: GitCompare,
            active: changedActive,
            onActivate: () => {
              setFilesView('changed')
              setEditingPath(null)
            },
          }}
        />
      ) : (
        <WorkspaceToolbarChip
          icon={GitCompare}
          label="Changed"
          count={files.length > 0 ? files.length : undefined}
          active={changedActive}
          onClick={viewChanges}
        />
      )}
      {checkResults.length > 0 ? (
        <WorkspaceToolbarChip
          icon={failingChecks > 0 ? ShieldAlert : ShieldCheck}
          label="Checks"
          count={failingChecks > 0 ? failingChecks : undefined}
          active={checksActive}
          onClick={() => {
            setFilesView('checks')
            setEditingPath(null)
            onSelectPath(null)
          }}
        />
      ) : null}
      <WorkspaceToolbarChip
        icon={FolderTree}
        label="Browse"
        active={browseActive}
        onClick={() => {
          setFilesView('browse')
          setEditingPath(null)
          onSelectPath(null)
        }}
      />
      <div className="ml-auto">{layoutControls}</div>
    </div>
  )

  // Editing takes precedence: it is the more recent, more explicit action.
  if (editingPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabBar}
        <div className="min-h-0 flex-1 p-2">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
              </div>
            }
          >
            <FileEditor runId={runId} path={editingPath} onClose={() => setEditingPath(null)} />
          </Suspense>
        </div>
      </div>
    )
  }

  if (selectedPath) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabBar}
        <div className="min-h-0 flex-1 p-2">
          <DiffPanel
            runId={runId}
            files={files}
            path={selectedPath}
            discardDisabled={undoDisabled}
            discardDisabledReason={undoDisabledReason}
            onClose={() => onSelectPath(null)}
            onSelect={onSelectPath}
            onDiscard={() => onSelectPath(null)}
            onDiscardAll={onUndoAllFiles}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabBar}

      <div
        className={`scroll-thin min-h-0 flex-1 overflow-y-auto ${
          filesView === 'browse' ? '' : 'px-4 py-4'
        }`}
      >
        {filesView === 'browse' ? (
          <FileTree
            runId={runId}
            selectedPath={lastBrowsedPath}
            onSelect={(path) => {
              setLastBrowsedPath(path)
              setEditingPath(path)
            }}
            changedPaths={changedPaths}
            expandedDirs={expandedDirs}
            onToggleDir={toggleDir}
          />
        ) : filesView === 'checks' ? (
          checkResults.length > 0 ? (
            <ChecksPanel
              runId={runId}
              results={checkResults}
              currentMessageId={currentMessageId}
              busy={runBusy}
            />
          ) : (
            <p className="text-sm text-muted-foreground/60">No checks ran for this run.</p>
          )
        ) : files.length > 0 ? (
          <FilesChanged
            files={files}
            activePath={reviewPath}
            onSelect={onReviewFile}
            onReview={() => {
              if (files[0]) onReviewFile(files[0].path)
            }}
            onUndoAll={onUndoAllFiles}
            undoDisabled={undoDisabled}
            undoDisabledReason={undoDisabledReason}
          />
        ) : (
          <p className="text-sm text-muted-foreground/60">No changed files in this workspace.</p>
        )}
      </div>
    </div>
  )
}
