/**
 * Changed-files card — Cursor-style summary above the composer / in the panel.
 *
 * Chevron toggles the file list; composer starts collapsed. Review and a file
 * row open the fullscreen diff viewer. Undo All is the run-scoped discard of
 * every remaining path.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DiffFile } from '../server/git'
import { FileTypeIcon } from './FileTypeIcon'

const statusTone: Record<DiffFile['status'], string> = {
  added: '',
  untracked: '',
  modified: '',
  deleted: 'text-danger line-through decoration-danger/50',
  renamed: 'text-accent',
}

export function DiffStat({
  additions,
  deletions,
  className = '',
}: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2 mono text-[11.5px] tabular-nums ${className}`}>
      {additions > 0 ? <span className="text-success">+{additions}</span> : null}
      {deletions > 0 ? <span className="text-danger">−{deletions}</span> : null}
      {additions === 0 && deletions === 0 ? <span className="text-muted-foreground">—</span> : null}
    </span>
  )
}

export function FilesChanged({
  files,
  activePath,
  onSelect,
  onReview,
  onUndoAll,
  undoDisabled = false,
  undoDisabledReason,
  variant = 'panel',
}: {
  files: DiffFile[]
  activePath: string | null
  onSelect: (path: string) => void
  onReview?: () => void
  onUndoAll?: () => void
  undoDisabled?: boolean
  undoDisabledReason?: string
  variant?: 'panel' | 'composer'
}) {
  const attached = variant === 'composer'
  const [expanded, setExpanded] = useState(!attached)

  if (files.length === 0) return null

  const openReview = onReview ?? (() => onSelect(files[0]!.path))

  return (
    <div
      className={
        attached
          ? 'chat-files-glass rounded-t-[16px] border border-b-0 border-border'
          : 'overflow-hidden rounded-xl border border-border bg-elevated shadow-sm'
      }
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/60"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span>
            {files.length} {files.length === 1 ? 'File' : 'Files'}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {onUndoAll ? (
            <button
              type="button"
              onClick={onUndoAll}
              disabled={undoDisabled}
              title={undoDisabled ? undoDisabledReason : 'Undo all changes from this run'}
              className="h-6 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Undo All
            </button>
          ) : null}
          <button
            type="button"
            onClick={openReview}
            className="h-6 rounded-md border border-border bg-secondary/80 px-2 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Review
          </button>
        </div>
      </div>

      {expanded ? (
        <div
          className={`scroll-thin space-y-px overflow-y-auto px-1.5 pb-1.5 ${
            attached ? 'max-h-[min(32vh,16rem)]' : 'max-h-[min(40vh,20rem)]'
          }`}
        >
          {files.map((file) => {
            const name = file.path.split('/').pop() ?? file.path
            const active = activePath === file.path
            return (
              <button
                type="button"
                key={file.path}
                onClick={() => onSelect(file.path)}
                title={file.path}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[12px] leading-5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 ${
                  active ? 'bg-secondary' : 'hover:bg-secondary/60'
                }`}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <FileTypeIcon path={file.path} className="size-3.5" />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    statusTone[file.status] || (active ? 'text-foreground' : 'text-foreground/82')
                  } ${active ? 'font-medium' : ''}`}
                >
                  {name}
                </span>
                {file.binary ? (
                  <span className="pe-1 mono text-[11px] text-muted-foreground">bin</span>
                ) : (
                  <DiffStat
                    additions={file.additions}
                    deletions={file.deletions}
                    className="pe-1"
                  />
                )}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
