/**
 * Usage — what each CLI has spent, read from its own history.
 *
 * The shape of the page follows the shape of the data. Codex publishes real
 * limit windows and Claude's come from its account, so those get a meter and a
 * projection; without a Claude login token its windows fall back to derived
 * ones and say so; the rest publish neither and say that instead of showing a
 * zero. The projects list is the part no CLI can show on its own — it is the
 * only place the machine's spend is broken down by the repo it went into.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { Gauge, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button, Card, EmptyState, PageHeader } from '../components/ui'
import { ProviderIcon } from '../components/ProviderIcons'
import { relativeTime } from '../lib/format'
import { useInvalidate, useUsageReport } from '../lib/queries'
import {
  USAGE_RANGES,
  formatCost,
  formatRate,
  formatResetIn,
  formatTokens,
  totalTokens,
  usageStatusMessage,
  type RuntimeUsage,
  type UsageProject,
  type UsageRange,
  type UsageWindow,
} from '../lib/usage'

export const Route = createFileRoute('/usage')({ component: UsagePage })

function UsagePage() {
  const [range, setRange] = useState<UsageRange>('30d')
  const { data: report, isLoading, isFetching } = useUsageReport(range)
  const invalidate = useInvalidate()
  const now = report?.generatedAt ?? Date.now()

  const runtimes = report?.runtimes ?? []
  const withUsage = runtimes.filter((r) => r.totalTokens > 0 || r.sessions > 0)
  const quiet = runtimes.filter((r) => r.totalTokens === 0 && r.sessions === 0)

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Usage"
        description="Tokens, cost, and plan limits read from each CLI's own history on this machine — including work you did outside Open Run."
        actions={
          <>
            <RangeTabs value={range} onChange={setRange} />
            <Button
              onClick={() => invalidate(['usageReport', 'usagePressure'])}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Rescan
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">
          Reading CLI history…
        </div>
      ) : runtimes.length === 0 ? (
        <EmptyState icon={<Gauge className="size-5" />} title="No runtimes configured">
          Add a runtime and its usage shows up here.
        </EmptyState>
      ) : (
        <div className={`flex flex-col gap-4 ${isFetching ? 'opacity-60' : ''}`}>
          <TotalsBar totals={report!.totals} />
          {withUsage.map((usage) => (
            <RuntimeCard key={usage.runtimeId} usage={usage} now={now} />
          ))}
          {quiet.length > 0 ? <QuietList runtimes={quiet} /> : null}
          {report!.projects.length > 0 ? <ProjectsCard projects={report!.projects} /> : null}
        </div>
      )}
    </div>
  )
}

function RangeTabs({
  value,
  onChange,
}: {
  value: UsageRange
  onChange: (next: UsageRange) => void
}) {
  return (
    <div role="tablist" className="flex items-center gap-px rounded-md bg-secondary p-0.5">
      {USAGE_RANGES.map((r) => (
        <button
          key={r.id}
          type="button"
          role="tab"
          aria-selected={value === r.id}
          onClick={() => onChange(r.id)}
          className={`rounded px-2 py-1 text-ui-sm transition-colors ${
            value === r.id
              ? 'bg-elevated text-foreground'
              : 'text-tier-tertiary hover:text-foreground'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

type Totals = {
  tokens: number
  costUsd: number
  unpricedTokens: number
  sessions: number
  openRunRuns: number
}

function TotalsBar({ totals }: { totals: Totals }) {
  return (
    <Card className="grid grid-cols-2 gap-px overflow-hidden bg-[var(--border-quaternary)] sm:grid-cols-4">
      <Stat label="Tokens, all CLIs" value={formatTokens(totals.tokens)} />
      <Stat
        label="Estimated cost"
        value={formatCost(totals.costUsd)}
        hint={totals.unpricedTokens > 0 ? `${formatTokens(totals.unpricedTokens)} unpriced` : ''}
      />
      <Stat label="CLI sessions" value={String(totals.sessions)} />
      <Stat label="Open Run runs" value={String(totals.openRunRuns)} />
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-elevated px-4 py-3">
      <div className="text-ui-sm text-tier-quaternary">{label}</div>
      <div className="mt-0.5 text-ui-lg tracking-tight text-foreground">{value}</div>
      {hint ? <div className="mt-0.5 text-ui-sm text-tier-quaternary">{hint}</div> : null}
    </div>
  )
}

/** Where the tokens went, across every CLI, resolved to projects where possible. */
function ProjectsCard({ projects }: { projects: UsageProject[] }) {
  const peak = Math.max(1, ...projects.map((p) => p.tokens))
  return (
    <Card>
      <div className="border-b border-[var(--border-quaternary)] px-4 py-2.5 text-ui-sm text-tier-secondary">
        Top folders
      </div>
      <div className="divide-y divide-[var(--border-quaternary)]">
        {projects.map((p) => (
          <div key={p.path || p.label} className="px-4 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              {p.projectId ? (
                <Link
                  to="/tasks"
                  className="min-w-0 truncate text-ui-sm text-tier-secondary hover:text-foreground"
                  title={p.path}
                >
                  {p.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-ui-sm text-tier-tertiary" title={p.path}>
                  {p.label}
                </span>
              )}
              <span className="shrink-0 text-ui-sm text-tier-tertiary">
                {p.tokens > 0 ? formatTokens(p.tokens) : `${p.sessions} sessions`}
                {p.costUsd !== null && p.costUsd > 0 ? (
                  <span className="ml-2 text-tier-quaternary">{formatCost(p.costUsd)}</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-tier-quaternary"
                style={{ width: `${Math.max(2, (p.tokens / peak) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function RuntimeCard({ usage, now }: { usage: RuntimeUsage; now: number }) {
  const [showModels, setShowModels] = useState(false)
  const hasTokens = usage.totalTokens > 0

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-quaternary)] px-4 py-3">
        <ProviderIcon kind={usage.kind} className="size-4 shrink-0" />
        <span className="text-ui-base text-foreground">{usage.label}</span>
        <code className="rounded bg-secondary px-1.5 py-0.5 text-ui-sm text-tier-tertiary">
          {usage.bin}
        </code>
        {usage.transport === 'acp' ? (
          <span className="text-ui-sm text-tier-quaternary">ACP</span>
        ) : null}
        {usage.plan ? (
          <span className="rounded bg-secondary px-1.5 py-0.5 text-ui-sm text-tier-tertiary">
            {usage.plan}
          </span>
        ) : null}
        <span className="ml-auto text-ui-sm text-tier-quaternary">
          {usage.openRunRuns > 0 ? `${usage.openRunRuns} Open Run runs · ` : ''}
          {usage.lastUsedAt ? `last used ${relativeTime(usage.lastUsedAt)}` : 'never used'}
        </span>
      </div>

      {usage.windows.length > 0 ? (
        <div className="flex flex-col gap-3 border-b border-[var(--border-quaternary)] px-4 py-3">
          {usage.windows.map((w) => (
            <WindowMeter key={w.id} window={w} now={now} />
          ))}
        </div>
      ) : null}

      {hasTokens ? (
        <div className="grid grid-cols-2 gap-px bg-[var(--border-quaternary)] sm:grid-cols-4">
          <Stat label="Total tokens" value={formatTokens(usage.totalTokens)} />
          <Stat label="Input" value={formatTokens(usage.tokens.input)} />
          <Stat label="Output" value={formatTokens(usage.tokens.output)} />
          <Stat
            label="Cost"
            value={formatCost(usage.costUsd)}
            hint={usage.unpricedTokens > 0 ? `${formatTokens(usage.unpricedTokens)} unpriced` : ''}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-px bg-[var(--border-quaternary)]">
          <Stat label="Sessions" value={String(usage.sessions)} />
          <Stat label="Messages" value={String(usage.messages)} />
        </div>
      )}

      {hasTokens ? (
        <div className="border-t border-[var(--border-quaternary)] px-4 py-3">
          <Sparkline usage={usage} />
        </div>
      ) : null}

      {usage.projects.length > 1 ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border-quaternary)] px-4 py-2.5 text-ui-sm text-tier-quaternary">
          {usage.projects.slice(0, 5).map((p) => (
            <span key={p.path || p.label} title={p.path}>
              {p.label}{' '}
              <span className="text-tier-tertiary">
                {p.tokens > 0 ? formatTokens(p.tokens) : `${p.sessions}×`}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {usage.models.length > 0 ? (
        <div className="border-t border-[var(--border-quaternary)]">
          <button
            type="button"
            onClick={() => setShowModels((v) => !v)}
            className="w-full px-4 py-2 text-left text-ui-sm text-tier-tertiary transition-colors hover:bg-hover hover:text-foreground"
          >
            {showModels ? 'Hide' : 'Show'} {usage.models.length} model
            {usage.models.length === 1 ? '' : 's'}
          </button>
          {showModels ? (
            <div className="divide-y divide-[var(--border-quaternary)] border-t border-[var(--border-quaternary)]">
              {usage.models.map((row) => (
                <div
                  key={row.model}
                  className="flex items-center justify-between gap-3 px-4 py-2 text-ui-sm"
                >
                  <code className="min-w-0 truncate text-tier-secondary">{row.model}</code>
                  <span className="shrink-0 text-tier-tertiary">
                    {formatTokens(totalTokens(row.tokens))}
                  </span>
                  <span className="w-16 shrink-0 text-right text-tier-tertiary">
                    {formatCost(row.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function WindowMeter({ window: w, now }: { window: UsageWindow; now: number }) {
  const reset = formatResetIn(w.resetsAt, now)
  const percent = w.usedPercent
  const overrun = w.projectedPercent !== null && w.projectedPercent > 100

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-ui-sm">
        <span className="text-tier-secondary">
          {w.label}
          {w.reported ? null : <span className="ml-1.5 text-tier-quaternary">derived</span>}
        </span>
        <span className="text-tier-tertiary">
          {percent !== null ? `${Math.round(percent)}%` : formatTokens(w.tokens)}
          {reset ? <span className="ml-2 text-tier-quaternary">{reset}</span> : null}
        </span>
      </div>
      {percent !== null ? (
        <div
          role="meter"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={w.label}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={`h-full rounded-full ${meterTone(percent)}`}
            style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
          />
        </div>
      ) : null}
      {w.tokensPerHour || w.projectedTokens || w.projectedPercent ? (
        <div className="mt-1 text-ui-sm text-tier-quaternary">
          {formatRate(w.tokensPerHour)}
          {w.tokensPerHour && (w.projectedTokens || w.projectedPercent) ? ' · ' : ''}
          {w.projectedPercent !== null
            ? `on pace for ${Math.round(w.projectedPercent)}% at reset`
            : w.projectedTokens
              ? `on pace for ${formatTokens(w.projectedTokens)} this window`
              : ''}
          {overrun ? <span className="ml-1.5 text-danger">over limit</span> : null}
        </div>
      ) : null}
    </div>
  )
}

function meterTone(percent: number): string {
  if (percent >= 90) return 'bg-danger'
  if (percent >= 70) return 'bg-warn'
  return 'bg-tier-secondary'
}

/** Daily totals in the selected range, drawn as bars so the shape reads at a glance. */
function Sparkline({ usage }: { usage: RuntimeUsage }) {
  const days = usage.daily
  const peak = useMemo(() => Math.max(1, ...days.map((d) => d.tokens)), [days])
  if (days.length === 0) return null

  return (
    <div>
      <div className="flex h-10 items-end gap-px">
        {days.map((day) => (
          <div
            key={day.date}
            title={`${day.date} · ${formatTokens(day.tokens)}${
              day.costUsd === null ? '' : ` · ${formatCost(day.costUsd)}`
            }`}
            className="min-w-[2px] flex-1 rounded-t-[1px] bg-tier-quaternary/40"
            style={{ height: `${Math.max(4, (day.tokens / peak) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-ui-sm text-tier-quaternary">
        <span>{days[0]?.date}</span>
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function QuietList({ runtimes }: { runtimes: RuntimeUsage[] }) {
  return (
    <Card className="divide-y divide-[var(--border-quaternary)]">
      {runtimes.map((usage) => (
        <div key={usage.runtimeId} className="flex items-center gap-2 px-4 py-2.5">
          <ProviderIcon kind={usage.kind} className="size-3.5 shrink-0 opacity-60" />
          <span className="text-ui-sm text-tier-secondary">{usage.label}</span>
          <span className="ml-auto min-w-0 truncate text-ui-sm text-tier-quaternary">
            {usageStatusMessage(usage)}
          </span>
        </div>
      ))}
    </Card>
  )
}
