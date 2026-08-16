/**
 * The one way a diff line is drawn in this app.
 *
 * The git panel (`DiffPanel`) and the transcript's inline edit hunks
 * (`chat/EditDiff`) both render these rows, so a change to gutters, markers,
 * or syntax colors lands in both places at once.
 */
import type { DiffLine } from '../lib/diff'
import type { HighlightToken } from '../lib/highlight'

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

export function LineNumber({ value }: { value: number | null }) {
  return (
    <span className="w-10 shrink-0 select-none px-1.5 text-right mono text-[10px] leading-[18px] text-muted-foreground">
      {value ?? ''}
    </span>
  )
}

export function CodeCell({ line, tokens }: { line: DiffLine | null; tokens?: HighlightToken[] }) {
  if (!line) {
    return <div className="flex-1 bg-[var(--bg-luminous-quaternary)]" />
  }
  const parts = tokens?.length ? tokens : [{ text: line.content || ' ', className: '' }]
  return (
    <div className={`flex min-w-0 flex-1 ${lineTone[line.type]}`}>
      <span
        className={`w-3.5 shrink-0 select-none mono text-[10px] leading-[18px] ${markerTone[line.type]}`}
      >
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

/** Marks the unchanged lines an inline hunk left out. */
export function SkippedLines({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-2 bg-[var(--bg-luminous-quaternary)] px-3 py-0.5 mono text-[10px] text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      <span>{count} unchanged</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
