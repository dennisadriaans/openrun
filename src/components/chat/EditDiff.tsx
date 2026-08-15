/**
 * The edit an `Edit` / `Write` tool call made, drawn as a real diff.
 *
 * The tool payload carries only `old_string` / `new_string`, so the hunk is
 * computed here (`lib/lineDiff.ts`) and then rendered with the git panel's own
 * rows (`components/DiffRows`) and highlighter — a chat edit and the same file
 * in Files changed look identical.
 */
import { useMemo } from 'react'
import type { DiffLine } from '../../lib/diff'
import { highlightDiffLines } from '../../lib/highlight'
import { collapseContext, diffLines, lineDiffStats } from '../../lib/lineDiff'
import type { ToolCallEditHunk } from '../../lib/toolCallView'
import { CodeCell, LineNumber, SkippedLines } from '../DiffRows'
import { FileTypeIcon } from '../FileTypeIcon'

/** Beyond this the transcript is a preview, not a review — open the file panel. */
const MAX_ROWS = 60

function HunkRows({ lines, path }: { lines: DiffLine[]; path: string }) {
  const tokens = useMemo(() => highlightDiffLines(lines, path), [lines, path])
  const rows = useMemo(() => collapseContext(lines, 3), [lines])
  const shown = rows.slice(0, MAX_ROWS)
  const hidden = rows.length - shown.length

  return (
    <>
      {shown.map((row, i) => (
        <div key={i}>
          {row.skippedBefore > 0 ? <SkippedLines count={row.skippedBefore} /> : null}
          <div className="flex items-start">
            <LineNumber value={row.line.newNumber ?? row.line.oldNumber} />
            <CodeCell line={row.line} tokens={tokens.get(row.line)} />
          </div>
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

export function EditDiff({
  hunks,
  path,
  onSelectFile,
}: {
  hunks: ToolCallEditHunk[]
  /** File the edit landed in — drives the icon and the grammar used. */
  path?: string
  onSelectFile?: (path: string) => void
}) {
  const parsed = useMemo(
    () =>
      hunks
        .map((hunk) => diffLines(hunk.oldString ?? '', hunk.newString ?? ''))
        .filter((lines) => lines.length > 0),
    [hunks],
  )
  if (parsed.length === 0) return null

  const totals = parsed.reduce(
    (acc, lines) => {
      const stats = lineDiffStats(lines)
      return {
        additions: acc.additions + stats.additions,
        deletions: acc.deletions + stats.deletions,
      }
    },
    { additions: 0, deletions: 0 },
  )
  const name = path ? (path.split('/').pop() ?? path) : null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-elevated">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        {path ? <FileTypeIcon path={path} className="size-3.5 shrink-0" /> : null}
        {name ? (
          onSelectFile && path ? (
            <button
              type="button"
              onClick={() => onSelectFile(path)}
              title={path}
              className="min-w-0 truncate text-left text-[12px] text-foreground transition-colors hover:text-accent"
            >
              {name}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[12px] text-foreground" title={path}>
              {name}
            </span>
          )
        ) : (
          <span className="text-[12px] text-muted-foreground">Edit</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
          {totals.additions > 0 ? (
            <span className="text-[var(--added)]">+{totals.additions}</span>
          ) : null}
          {totals.deletions > 0 ? (
            <span className="text-[var(--removed)]">−{totals.deletions}</span>
          ) : null}
        </span>
      </div>
      <div className="scroll-thin max-h-80 overflow-auto">
        {parsed.map((lines, i) => (
          <div key={i} className={i > 0 ? 'border-t border-border' : ''}>
            <HunkRows lines={lines} path={path ?? 'snippet'} />
          </div>
        ))}
      </div>
    </div>
  )
}
