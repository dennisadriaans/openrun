/**
 * Installable planner proposal cards — shared by the Planner page and
 * planner-run chat. "Save & activate" creates + arms; Ignore dismisses.
 */
import { Link } from '@tanstack/react-router'
import { Check, Loader2, Power, X } from 'lucide-react'
import { useState } from 'react'
import { isValidCron } from '../lib/cron'
import { enableBlockedReason } from '../lib/enableGate'
import { describeCron } from '../lib/format'
import type { PlanProposal } from '../lib/planProposals'
import { proposalFingerprint } from '../lib/planProposals'
import { hasTaskPrompt } from '../lib/taskPrompt'
import { hasWorkspaceId } from '../lib/workspaceRef'
import { useInstallPlanProposal, useRuntimes } from '../lib/queries'
import { Button, Card, Field, inputClass } from './ui'

export type ProposalInstallState = {
  taskId: string
  name: string
}

export function PlanProposalCard({
  proposal: initial,
  runtimeId,
  workspaceId,
  workspaceReady,
  workspaceStatus,
  onIgnore,
  onInstalled,
  installed,
  compact = false,
}: {
  proposal: PlanProposal
  runtimeId: string
  workspaceId: string
  workspaceReady: boolean
  workspaceStatus?: string | null
  onIgnore: () => void
  onInstalled?: (state: ProposalInstallState) => void
  installed?: ProposalInstallState | null
  /** Tighter chrome for chat. */
  compact?: boolean
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const install = useInstallPlanProposal()
  const { data: runtimes } = useRuntimes()
  const runtime = runtimes?.find((r) => r.id === runtimeId)

  const patch = (p: Partial<PlanProposal>) => {
    setDraft((d) => ({ ...d, ...p }))
    setError(null)
  }

  const blockedReason = enableBlockedReason({
    cron: draft.cron,
    cronValid: isValidCron(draft.cron),
    workspaceValid: hasWorkspaceId(workspaceId),
    workspaceReady,
    workspaceStatus,
    runtimeInstalled: runtime?.installed ?? false,
    runtimeBin: runtime?.bin,
    promptValid: hasTaskPrompt(draft.prompt),
  })

  const activate = async () => {
    if (blockedReason) return
    setError(null)
    try {
      const task = await install.mutateAsync({
        runtimeId,
        workspaceId,
        proposal: draft,
        enabled: true,
      })
      onInstalled?.({ taskId: task.id, name: task.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (installed) {
    return (
      <Card className={compact ? 'p-3' : 'p-4'}>
        <div className="flex items-center gap-2 text-ui-base text-tier-secondary">
          <Check className="h-3.5 w-3.5 text-success" />
          <span className="min-w-0 truncate font-medium text-foreground">{installed.name}</span>
          <span className="text-tier-tertiary">armed</span>
          <Link
            to="/tasks/$taskId"
            params={{ taskId: installed.taskId }}
            className="ms-auto text-xs text-tier-secondary underline underline-offset-2 hover:text-foreground"
          >
            Open automation →
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className={compact ? 'border-border/80 bg-chrome/40 p-3' : 'p-4'}>
      {draft.description ? (
        <p className="mb-3 text-ui-sm text-tier-tertiary">{draft.description}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Cron" hint={<span className="mono">{describeCron(draft.cron)}</span>}>
          <input
            className={`${inputClass} mono text-[13px]`}
            value={draft.cron}
            onChange={(e) => patch({ cron: e.target.value })}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Prompt">
          <textarea
            className={`${inputClass} min-h-20 mono text-[12.5px]`}
            value={draft.prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
          />
        </Field>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-border px-3 py-2 text-ui-sm text-tier-secondary">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void activate()}
          disabled={Boolean(blockedReason) || install.isPending}
          title={blockedReason ?? 'Create automation and arm its schedule'}
        >
          {install.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          Save &amp; activate
        </Button>
        <Button
          variant="ghost"
          onClick={onIgnore}
          disabled={install.isPending}
          title="Dismiss this proposal"
        >
          <X className="h-3.5 w-3.5" />
          Ignore
        </Button>
        {blockedReason ? (
          <span className="text-ui-sm text-tier-tertiary">{blockedReason}</span>
        ) : null}
      </div>
    </Card>
  )
}

export function PlanProposalList({
  proposals,
  runtimeId,
  workspaceId,
  workspaceReady,
  workspaceStatus,
  runId,
  dismissed,
  onDismiss,
  installed,
  onInstalled,
  compact = false,
}: {
  proposals: PlanProposal[]
  runtimeId: string
  workspaceId: string
  workspaceReady: boolean
  workspaceStatus?: string | null
  runId?: string
  dismissed: Set<string>
  onDismiss: (fp: string) => void
  installed: Record<string, ProposalInstallState>
  onInstalled: (fp: string, state: ProposalInstallState) => void
  compact?: boolean
}) {
  const visible = proposals.filter((p) => !dismissed.has(proposalFingerprint(p)))
  if (visible.length === 0) {
    return (
      <p className="text-ui-base text-tier-tertiary">
        No proposals left{runId ? ' for this plan' : ''}.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {visible.map((p) => {
        const fp = proposalFingerprint(p)
        return (
          <PlanProposalCard
            key={fp}
            proposal={p}
            runtimeId={runtimeId}
            workspaceId={workspaceId}
            workspaceReady={workspaceReady}
            workspaceStatus={workspaceStatus}
            compact={compact}
            installed={installed[fp] ?? null}
            onIgnore={() => onDismiss(fp)}
            onInstalled={(state) => onInstalled(fp, state)}
          />
        )
      })}
    </div>
  )
}
