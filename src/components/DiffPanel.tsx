/**
 * Diff viewer — PR-review-pane layout.
 *
 * Stacked per-file cards with sticky headers, expand/collapse, and
 * unified/split hunk rendering from parsed unified-diff (see lib/diff.ts).
 * Optional fullscreen modal for wider split reading.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Columns2, Copy, List, Maximize2, Minimize2, Rows2, X } from 'lucide-react'
import type { DiffFile } from '../server/git'
import { parseUnifiedDiff, toSplitRows, type DiffHunk, type DiffLine } from '../lib/diff'
import { highlightHunk, type HighlightToken } from '../lib/highlight'
import { useFileDiff } from '../lib/queries'
import { FileTypeIcon } from './FileTypeIcon'

type ViewMode = 'split' | 'unified'

const lineTone: Record<DiffLine['type'], string> = {
  add: 'bg-[var(--diffs-bg-addition-override)]',
  delete: 'bg-[var(--diffs-bg-deletion-override)]',
  context: '',
}

const markerTone: Record<DiffLine['type'], string> = {
  add: 'text-[var(--added)]',
  delete: 'text-[var(--removed)]',
  context: 'text-text-300',
}

const marker: Record<DiffLine['type'], string> = { add: '+', delete: '−', context: ' ' }

function LineNumber({ value }: { value: number | null }) {
  return (
    <span className="w-10 shrink-0 select-none px-1.5 text-right mono text-[10px] leading-[18px] text-muted-foreground">
      {value ?? ''}
    </span>
  )
}

function CodeCell({ line, tokens }: { line: DiffLine | null; tokens?: HighlightToken[] }) {
  if (!line) {
    return <div className="flex-1 bg-[var(--bg-luminous-quaternary)]" />
  }
  const parts = tokens?.length ? tokens : [{ text: line.content || ' ', className: '' }]
  return (
    <div className={`flex min-w-0 flex-1 ${lineTone[line.type]}`}>
      <span className={`w-3.5 shrink-0 select-none mono text-[10px] leading-[18px] ${markerTone[line.type]}`}>
        {marker[line.type]}
      </span>
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all mono text-[11px] leading-[18px] text-[var(--syntax-foreground)]">
        {parts.map((part, i) =>
          part.className ? (
            <span key={i} className={part.className}>
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text || ' '}</span>
          ),
        )}
      </pre>
    </div>
  )
}

function UnifiedHunk({ hunk, path }: { hunk: DiffHunk; path: string }) {
  const tokens = useMemo(() => highlightHunk(hunk, path), [hunk, path])
  return (
    <>
      {hunk.lines.map((line, i) => (
        <div key={i} className="flex items-start">
          <LineNumber value={line.newNumber ?? line.oldNumber} />
          <CodeCell line={line} tokens={tokens.get(line)} />
        </div>
      ))}
    </>
  )
}

function SplitHunk({ hunk, path }: { hunk: DiffHunk; path: string }) {
  const rows = useMemo(() => toSplitRows(hunk), [hunk])
  const tokens = useMemo(() => highlightHunk(hunk, path), [hunk, path])
  return (
    <>
      {rows.map((row, i) => (
        <div key={i} className="flex items-start">
          <div className="flex min-w-0 flex-1 border-r border-border">
            <LineNumber value={row.left?.oldNumber ?? null} />
            <CodeCell line={row.left} tokens={row.left ? tokens.get(row.left) : undefined} />
          </div>
          <div className="flex min-w-0 flex-1">
            <LineNumber value={row.right?.newNumber ?? null} />
            <CodeCell line={row.right} tokens={row.right ? tokens.get(row.right) : undefined} />
          </div>
        </div>
      ))}
    </>
  )
}

function DiffFileCard({
  runId,
  file,
  expanded,
  mode,
  onToggle,
}: {
  runId: string
  file: DiffFile
  expanded: boolean
  mode: ViewMode
  onToggle: () => void
}) {
  const { data, isLoading } = useFileDiff(runId, expanded ? file.path : null)
  const parsed = useMemo(() => parseUnifiedDiff(data?.diff ?? ''), [data?.diff])
  const isNew = file.status === 'added' || file.status === 'untracked'

  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(file.path)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="pb-3">
      <div className="w-full overflow-clip rounded-lg [clip-path:inset(0_round_0.5rem)] [isolation:isolate] bg-elevated">
        <div className="sticky top-0 z-[60] bg-elevated p-[1px] pb-0">
          <div className="rounded-t-lg border border-border bg-elevated py-1.5 pl-1 pr-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggle}
                  aria-label="Toggle diff"
                  className="flex items-center justify-center rounded border-none p-1 text-muted-foreground outline-none transition-colors hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground focus:outline-none focus:ring-0"
                >
                  <ChevronRight
                    className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                </button>
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <div className="group/name inline-flex max-w-full min-w-0 shrink items-center gap-1">
                    <FileTypeIcon path={file.path} className="size-3.5" />
                    <button
                      type="button"
                      onClick={onToggle}
                      className="-mx-1 min-w-0 overflow-hidden whitespace-nowrap rounded px-1 text-left text-[12px] text-foreground transition-colors duration-300"
                      title={file.path}
                    >
                      {file.path}
                    </button>
                    <button
                      type="button"
                      onClick={copyName}
                      aria-label="Copy file name"
                      className="flex shrink-0 items-center justify-center rounded border-none p-1 text-muted-foreground opacity-0 outline-none transition-all hover:bg-[var(--bg-luminous-quaternary)] hover:text-foreground focus:outline-none focus:ring-0 group-hover/name:opacity-100"
                    >
                      <Copy className="h-[13px] w-[13px]" aria-hidden />
                    </button>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {file.additions > 0 ? (
                      <span className="flex items-center gap-1 text-[12px] tabular-nums text-[var(--added)]">
                        +{file.additions}
                      </span>
                    ) : null}
                    {file.deletions > 0 ? (
                      <span className="flex items-center gap-1 text-[12px] tabular-nums text-[var(--removed)]">
                        −{file.deletions}
                      </span>
                    ) : null}
                    {isNew ? (
                      <span className="flex-shrink-0 rounded bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-1.5 py-0.5 text-xs text-[var(--added)]">
                        New
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {expanded ? (
          <div className="m-[1px] mt-0 min-h-0 overflow-hidden rounded-b-lg border border-t-0 border-border">
            <div className="w-full overflow-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
              <div className="flex w-full flex-col bg-elevated">
                {isLoading ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">Loading diff…</div>
                ) : parsed.binary || file.binary ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">
                    Binary file — no preview available.
                  </div>
                ) : parsed.hunks.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">
                    No textual changes to display.
                  </div>
                ) : (
                  parsed.hunks.map((hunk, i) => (
                    <div key={i} className="border-b border-border last:border-b-0">
                      <div className="sticky top-0 z-10 bg-[var(--bg-luminous-quaternary)] px-3 py-1 mono text-[10px] text-muted-foreground">
                        @@ −{hunk.oldStart} +{hunk.newStart} @@ {hunk.header}
                      </div>
                      {mode === 'split' ? (
                        <SplitHunk hunk={hunk} path={file.path} />
                      ) : (
                        <UnifiedHunk hunk={hunk} path={file.path} />
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function DiffPanel({
  runId,
  files,
  path,
  onClose,
  onSelect,
}: {
  runId: string
  files: DiffFile[]
  path: string
  onClose: () => void
  onSelect: (path: string) => void
  onDiscard?: (path: string) => void
}) {
  const [mode, setMode] = useState<ViewMode>('unified')
  const [fullscreen, setFullscreen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([path]))

  useEffect(() => {
    setExpanded((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (fullscreen) {
        setFullscreen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, onClose])

  useEffect(() => {
    if (!fullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [fullscreen])

  const toggle = (filePath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
    onSelect(filePath)
  }

  const panel = (
    <aside className="flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-border bg-elevated shadow-2xl shadow-[var(--shadow-primary)]">
      <div className="flex h-full flex-col">
        <div className="flex flex-col border-b border-border pb-0 pt-2">
          <div className="mb-0.5 flex min-h-[28px] items-center gap-4 px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-foreground">
                Files changed
              </span>
            </div>
            <button
              type="button"
              onClick={() => (fullscreen ? setFullscreen(false) : onClose())}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Close diff'}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--bg-luminous-tertiary)] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex min-w-0 items-center justify-between gap-2 px-3 pb-1.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
              <button
                type="button"
                className="relative flex h-[26px] items-center justify-center rounded-md border border-transparent bg-[var(--bg-luminous-tertiary)] px-3 text-[12px] font-medium text-foreground outline-none"
              >
                Diff
              </button>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMode(mode === 'split' ? 'unified' : 'split')}
                aria-label={mode === 'split' ? 'Switch to unified diff view' : 'Switch to split diff view'}
                className="relative flex h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground outline-none transition-colors hover:bg-[var(--bg-luminous-tertiary)] hover:text-foreground"
              >
                {mode === 'split' ? (
                  <Rows2 className="h-3 w-3" aria-hidden />
                ) : (
                  <Columns2 className="h-3 w-3" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={fullscreen ? 'Exit fullscreen diff' : 'Open fullscreen diff'}
                aria-pressed={fullscreen}
                title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className={`relative flex h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent outline-none transition-colors hover:bg-[var(--bg-luminous-tertiary)] hover:text-foreground ${
                  fullscreen
                    ? 'bg-[var(--bg-luminous-tertiary)] text-foreground'
                    : 'bg-transparent text-muted-foreground'
                }`}
              >
                {fullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="relative flex h-[26px] w-[26px] items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground outline-none transition-colors hover:bg-[var(--bg-luminous-tertiary)] hover:text-foreground"
                aria-label="File list"
              >
                <List className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 min-w-0 overflow-y-auto bg-transparent [scrollbar-gutter:stable]">
            <div className="flex min-h-0 flex-col">
              <div className="min-h-full px-3 pt-3">
                {files.map((file) => (
                  <DiffFileCard
                    key={file.path}
                    runId={runId}
                    file={file}
                    expanded={expanded.has(file.path)}
                    mode={mode}
                    onToggle={() => toggle(file.path)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )

  if (fullscreen) {
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-stretch justify-center bg-scrim p-3 backdrop-blur-sm sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-label="Fullscreen diff viewer"
        onClick={() => setFullscreen(false)}
      >
        <div
          className="flex min-h-0 w-full max-w-[1600px] flex-1"
          onClick={(e) => e.stopPropagation()}
        >
          {panel}
        </div>
      </div>,
      document.body,
    )
  }

  return panel
}
