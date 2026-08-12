/**
 * "Files Changed" summary box.
 *
 * Lists every file the run's workspace differs from HEAD on, collapsed to a few
 * rows with a "Show N more" expander. Clicking a file opens the diff panel.
 *
 * Layout adapted from the t3code run view (MIT, T3 Tools Inc.).
 */
import { useState } from 'react'
import { FileDiff, MoreHorizontal } from 'lucide-react'
import type { DiffFile } from '../server/git'
import { FileTypeIcon } from './FileTypeIcon'

const COLLAPSED_COUNT = 4

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
      {additions === 0 && deletions === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : null}
    </span>
  )
}

export function FilesChanged({
  files,
  activePath,
  onSelect,
  onReview,
}: {
  files: DiffFile[]
  activePath: string | null
  onSelect: (path: string) => void
  onReview?: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (files.length === 0) return null

  const visible = expanded ? files : files.slice(0, COLLAPSED_COUNT)
  const hidden = files.length - visible.length
  const additions = files.reduce((n, f) => n + f.additions, 0)
  const deletions = files.reduce((n, f) => n + f.deletions, 0)

  return (
    <div className="rounded-2xl border border-border bg-[color-mix(in_srgb,var(--foreground)_2.5%,var(--bg-chrome))] p-2 pt-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2 px-2">
        <p className="flex items-center gap-1 whitespace-nowrap font-medium text-foreground text-xs leading-4">
          <span>
            {files.length} changed file{files.length === 1 ? '' : 's'}
          </span>
          {additions > 0 || deletions > 0 ? (
            <DiffStat additions={additions} deletions={deletions} className="text-xs leading-4" />
          ) : null}
        </p>
        {onReview ? (
          <button
            onClick={onReview}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Review
          </button>
        ) : null}
      </div>

      <div className="space-y-px">
        {visible.map((file) => {
          const name = file.path.split('/').pop() ?? file.path
          const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '')
          const active = activePath === file.path
          return (
            <button
              key={file.path}
              onClick={() => onSelect(file.path)}
              className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] leading-5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 ${
                active ? 'bg-secondary' : 'hover:bg-secondary/60'
              }`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <FileTypeIcon path={file.path} className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {dir ? <span className="text-muted-foreground">{dir}/</span> : null}
                <span
                  className={`${active ? 'font-medium' : ''} ${
                    statusTone[file.status] ||
                    (active ? 'text-foreground' : 'text-foreground/82')
                  }`}
                >
                  {name}
                </span>
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

        {hidden > 0 ? (
          <button
            onClick={() => setExpanded(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <MoreHorizontal className="size-4 shrink-0" />
            Show {hidden} more
          </button>
        ) : null}

        {expanded && files.length > COLLAPSED_COUNT ? (
          <button
            onClick={() => setExpanded(false)}
            className="flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <FileDiff className="size-4 shrink-0" />
            Show less
          </button>
        ) : null}
      </div>
    </div>
  )
}
