/**
 * The edit an `Edit` / `Write` tool call made, drawn as a real diff.
 *
 * One Cursor-style card per change block: file icon, basename, +/−, the hunk,
 * and Undo when that path is still in the run's remaining diff. After Undo the
 * card washes out and Redo puts the bytes back.
 */
import { useMemo } from 'react'
import { matchDiffPath, type DiffLine } from '../../lib/diff'
import { highlightDiffLines } from '../../lib/highlight'
import { diffLines, lineDiffStats, splitChangeBlocks } from '../../lib/lineDiff'
import type { ToolCallEditHunk } from '../../lib/toolCallView'
import { CodeCell, LineNumber } from '../DiffRows'
import { FileTypeIcon } from '../FileTypeIcon'

const MAX_ROWS = 60

function HunkRows({ lines, path }: { lines: DiffLine[]; path: string }) {
  const tokens = useMemo(() => highlightDiffLines(lines, path), [lines, path])
  const shown = lines.slice(0, MAX_ROWS)
  const hidden = lines.length - shown.length

  return (
    <>
      {shown.map((line, i) => (
        <div key={i} className="flex items-start">
          <LineNumber value={line.newNumber ?? line.oldNumber} />
          <CodeCell line={line} tokens={tokens.get(line)} />
        </div>
      ))}
      {hidden > 0 ? (
        <div className="bg-[var(--bg-luminous-quaternary)] px-3 py-1 mono text-[10px] text-muted-foreground">
          {hidden} more lines — open the file to see the rest
        </div>
      ) : null}
    </>
  )
}

function ChangeAction({
  label,
  busyLabel,
  disabled,
  pending,
  title,
  onClick,
}: {
  label: string
  busyLabel: string
  disabled?: boolean
  pending?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      title={title}
      className="h-[22px] rounded-md px-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? busyLabel : label}
    </button>
  )
}

function ChangeBlock({
  lines,
  path,
  undone,
  onOpen,
  onUndo,
  onRedo,
  undoDisabled,
  undoDisabledReason,
  undoBusy,
  redoBusy,
}: {
  lines: DiffLine[]
  path?: string
  undone?: boolean
  onOpen?: (path: string) => void
  onUndo?: () => void
  onRedo?: () => void
  undoDisabled?: boolean
  undoDisabledReason?: string
  undoBusy?: boolean
  redoBusy?: boolean
}) {
  const stats = lineDiffStats(lines)
  const name = path ? (path.split('/').pop() ?? path) : 'Edit'
  const open = path && onOpen ? () => onOpen(path) : undefined
  const faded = undone ? 'opacity-40 saturate-50' : ''

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-elevated">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <div className={`flex min-w-0 flex-1 items-center gap-2 ${faded}`}>
          {path ? <FileTypeIcon path={path} className="size-3.5 shrink-0" /> : null}
          {open ? (
            <button
              type="button"
              onClick={open}
              title={path}
              className="min-w-0 flex-1 truncate text-left text-[12px] text-foreground transition-colors hover:text-accent"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground" title={path}>
              {name}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
            {stats.additions > 0 ? (
              <span className="text-[var(--added)]">+{stats.additions}</span>
            ) : null}
            {stats.deletions > 0 ? (
              <span className="text-[var(--removed)]">−{stats.deletions}</span>
            ) : null}
          </span>
        </div>
        {undone && onRedo ? (
          <ChangeAction
            label="Redo"
            busyLabel="Redoing…"
            disabled={undoDisabled}
            pending={redoBusy}
            title={undoDisabled ? undoDisabledReason : 'Re-apply this change'}
            onClick={onRedo}
          />
        ) : onUndo ? (
          <ChangeAction
            label="Undo"
            busyLabel="Undoing…"
            disabled={undoDisabled}
            pending={undoBusy}
            title={
              undoDisabled ? undoDisabledReason : "Restore this file to the run's starting snapshot"
            }
            onClick={onUndo}
          />
        ) : null}
      </div>
      <div className={`scroll-thin max-h-80 overflow-auto ${faded}`}>
        <HunkRows lines={lines} path={path ?? 'snippet'} />
      </div>
    </div>
  )
}

export function EditDiff({
  hunks,
  path,
  onSelectFile,
  onUndoFile,
  onRedoFile,
  undoDisabled,
  undoDisabledReason,
  undoBusyPath,
  redoBusyPath,
  changedPaths,
  undonePaths,
  redoablePaths,
}: {
  hunks: ToolCallEditHunk[]
  path?: string
  onSelectFile?: (path: string) => void
  onUndoFile?: (path: string) => void
  onRedoFile?: (path: string) => void
  undoDisabled?: boolean
  undoDisabledReason?: string
  undoBusyPath?: string | null
  redoBusyPath?: string | null
  changedPaths?: string[]
  undonePaths?: string[]
  redoablePaths?: string[]
}) {
  const blocks = useMemo(
    () =>
      hunks.flatMap((hunk) =>
        splitChangeBlocks(diffLines(hunk.oldString ?? '', hunk.newString ?? '')),
      ),
    [hunks],
  )
  if (blocks.length === 0) return null

  const knownPaths = [...(changedPaths ?? []), ...(undonePaths ?? [])]
  const gitPath = path ? matchDiffPath(path, knownPaths) : undefined
  const undone = Boolean(gitPath && undonePaths?.includes(gitPath))
  const canUndo = Boolean(gitPath && onUndoFile && !undone)
  const canRedo = Boolean(gitPath && onRedoFile && undone && redoablePaths?.includes(gitPath))
  const undoBusy = Boolean(gitPath && undoBusyPath === gitPath)
  const redoBusy = Boolean(gitPath && redoBusyPath === gitPath)

  return (
    <div className="space-y-2">
      {blocks.map((lines, i) => (
        <ChangeBlock
          key={i}
          lines={lines}
          path={path}
          undone={undone}
          onOpen={onSelectFile}
          {...(canUndo && gitPath ? { onUndo: () => onUndoFile?.(gitPath) } : {})}
          {...(canRedo && gitPath ? { onRedo: () => onRedoFile?.(gitPath) } : {})}
          undoDisabled={undoDisabled}
          undoDisabledReason={undoDisabledReason}
          undoBusy={undoBusy}
          redoBusy={redoBusy}
        />
      ))}
    </div>
  )
}
