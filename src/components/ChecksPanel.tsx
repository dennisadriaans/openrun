/**
 * "Checks" tab body for the run detail right panel.
 *
 * Answers the question the Changed tab cannot: the agent changed these files —
 * do they still build? Rows stream in live over SSE, so a long test suite fills
 * in as it goes rather than appearing all at once when the run finally settles.
 *
 * Follows the FilesChanged layout so the panel reads as one column.
 */
import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  MinusCircle,
  RefreshCw,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { CachedCheckResult } from '../lib/applyRunLiveEvent'
import { isFailingOutcome, isPassStale, latestPass } from '../lib/checkPass'
import { duration } from '../lib/format'
import { useRerunChecks, useSendMessage } from '../lib/queries'
import { Button } from './ui'
import { buildFixChecksPrompt, type CheckOutcome } from '../lib/verdict'

const OUTCOME_META: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  passed: { icon: CheckCircle2, tone: 'text-success', label: 'passed' },
  failed: { icon: XCircle, tone: 'text-danger', label: 'failed' },
  timeout: { icon: Clock, tone: 'text-danger', label: 'timed out' },
  skipped: { icon: MinusCircle, tone: 'text-tier-quaternary', label: 'skipped' },
  running: { icon: CircleDashed, tone: 'text-tier-tertiary', label: 'running' },
}

function outcomeMeta(outcome: string) {
  return OUTCOME_META[outcome] ?? OUTCOME_META.skipped
}

function CheckRow({ result }: { result: CachedCheckResult }) {
  const [open, setOpen] = useState(false)
  const meta = outcomeMeta(result.outcome)
  const Icon = meta.icon
  const hasOutput = result.output.trim().length > 0
  const failed = result.outcome === 'failed' || result.outcome === 'timeout'

  return (
    <div>
      <button
        type="button"
        onClick={() => (hasOutput ? setOpen((v) => !v) : undefined)}
        disabled={!hasOutput}
        className={`flex w-full items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] leading-5 transition-colors duration-150 ${
          hasOutput ? 'cursor-pointer hover:bg-secondary/60' : 'cursor-default'
        }`}
      >
        <span className={`flex size-5 shrink-0 items-center justify-center ${meta.tone}`}>
          <Icon
            className={`size-3.5 ${result.outcome === 'running' ? 'animate-spin [animation-duration:2s]' : ''}`}
          />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-foreground/82">{result.name}</span>
        </span>
        {result.finishedAt ? (
          <span className="pe-1 mono text-[11px] tabular-nums text-muted-foreground">
            {duration(result.startedAt, result.finishedAt)}
          </span>
        ) : null}
        {hasOutput ? (
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
        ) : null}
      </button>

      {open && hasOutput ? (
        <pre className="mx-0.5 mt-1 mb-1.5 max-h-64 overflow-auto rounded-md border border-border bg-[var(--bg-quaternary)] px-2 py-1.5 mono text-[11px] leading-4 text-tier-secondary whitespace-pre-wrap">
          {result.output}
        </pre>
      ) : null}

      {failed && !open && hasOutput ? (
        <p className="mx-0.5 mb-1 truncate mono text-[11px] text-danger/80">
          {result.output.trim().split('\n').slice(-1)[0]}
        </p>
      ) : null}
    </div>
  )
}

export function ChecksPanel({
  runId,
  results,
  /** Newest assistant message on the run — what "current" means for staleness. */
  currentMessageId,
  /** True while the agent is mid-turn: neither action is safe to offer. */
  busy,
}: {
  runId: string
  results: CachedCheckResult[]
  currentMessageId: string
  busy: boolean
}) {
  const rerun = useRerunChecks(runId)
  const sendMessage = useSendMessage(runId)

  // Only the newest pass is the run's current state — earlier passes are what
  // a repair turn already fixed, and showing them reads as duplicate failures.
  const latest = useMemo(() => latestPass(results), [results])
  const stale = useMemo(() => isPassStale(results, currentMessageId), [results, currentMessageId])

  if (results.length === 0) return null

  const earlierPasses = latest[0]?.attempt ?? 0
  const failed = latest.filter((r) => isFailingOutcome(r.outcome))
  const passed = latest.filter((r) => r.outcome === 'passed')
  const running = latest.some((r) => r.outcome === 'running') || rerun.isPending

  const active = latest.find((r) => r.outcome === 'running')
  const headline = running
    ? active
      ? `Running ${active.name}…`
      : 'Running checks…'
    : failed.length > 0
      ? `${failed.length} check${failed.length === 1 ? '' : 's'} failing`
      : `${passed.length} check${passed.length === 1 ? '' : 's'} passing`

  const fixChecks = () => {
    sendMessage.mutate({
      prompt: buildFixChecksPrompt(
        failed.map((r) => ({
          name: r.name,
          command: r.command,
          outcome: r.outcome as CheckOutcome,
          exitCode: r.exitCode,
          output: r.output,
        })),
      ),
    })
  }

  const actionsDisabled = busy || running || sendMessage.isPending

  return (
    <div className="rounded-2xl border border-border bg-[color-mix(in_srgb,var(--foreground)_2.5%,var(--bg-chrome))] p-2 pt-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2 px-2">
        <p className="flex items-center gap-1 whitespace-nowrap font-medium text-foreground text-xs leading-4">
          {headline}
        </p>
        {earlierPasses > 0 ? (
          <span className="text-xs text-muted-foreground">
            after {earlierPasses} repair turn{earlierPasses === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {stale && !running ? (
        <p className="mx-0.5 mb-2 rounded-md bg-[var(--bg-quaternary)] px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          From an earlier turn — the workspace has changed since. Re-run to see where it stands now.
        </p>
      ) : null}

      <div className="space-y-px">
        {latest.map((result) => (
          <CheckRow key={result.id} result={result} />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5 px-0.5">
        <Button
          variant="default"
          onClick={() => rerun.mutate()}
          disabled={actionsDisabled}
          title="Run this project's checks against the workspace as it is now"
        >
          <RefreshCw className={`size-3.5 ${rerun.isPending ? 'animate-spin' : ''}`} />
          Re-run checks
        </Button>
        {failed.length > 0 ? (
          <Button variant="primary" onClick={fixChecks} disabled={actionsDisabled}>
            <Wrench className="size-3.5" />
            Fix checks
          </Button>
        ) : null}
      </div>

      {rerun.isError ? (
        <p className="mt-2 px-0.5 text-[11px] leading-4 text-danger">
          {(rerun.error as Error).message}
        </p>
      ) : null}
    </div>
  )
}
