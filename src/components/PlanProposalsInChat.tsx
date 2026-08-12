/**
 * Planner proposals embedded in run chat.
 * Reuses the run's stored install-target workspace (chosen on /planner).
 * Legacy planner runs without a workspaceId get a one-time picker fallback.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  PlanProposalList,
  type ProposalInstallState,
} from './PlanProposalCard'
import { WorkspacePicker } from './WorkspacePicker'
import {
  loadDismissedProposals,
  persistDismissedProposals,
} from '../lib/planProposalDismiss'
import type { PlanProposal } from '../lib/planProposals'
import { useWorkspaces } from '../lib/queries'
import { hasWorkspaceId } from '../lib/workspaceRef'
import { isWorkspaceReady } from '../lib/workspaceReady'

export function PlanProposalsInChat({
  proposals,
  runtimeId,
  runId,
  workspaceId: runWorkspaceId,
  workspaceReady: runWorkspaceReady,
  workspaceStatus: runWorkspaceStatus,
  projectId: runProjectId,
  projectName,
  workspaceLabel,
}: {
  proposals: PlanProposal[]
  runtimeId: string
  runId: string
  workspaceId?: string
  workspaceReady?: boolean
  workspaceStatus?: string | null
  projectId?: string
  projectName?: string | null
  workspaceLabel?: string | null
}) {
  const hasRunWorkspace = hasWorkspaceId(runWorkspaceId ?? '')
  const [projectId, setProjectId] = useState(runProjectId ?? '')
  const [workspaceId, setWorkspaceId] = useState(runWorkspaceId ?? '')
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    loadDismissedProposals(runId),
  )
  const [installed, setInstalled] = useState<Record<string, ProposalInstallState>>({})
  const { data: workspaces } = useWorkspaces(
    hasRunWorkspace ? undefined : projectId || undefined,
  )

  useEffect(() => {
    setDismissed(loadDismissedProposals(runId))
    setInstalled({})
    if (hasRunWorkspace) {
      setWorkspaceId(runWorkspaceId ?? '')
      setProjectId(runProjectId ?? '')
    }
  }, [runId, hasRunWorkspace, runWorkspaceId, runProjectId])

  const selectedWorkspace = useMemo(
    () => workspaces?.find((w) => w.id === workspaceId),
    [workspaces, workspaceId],
  )

  const effectiveWorkspaceId = hasRunWorkspace ? (runWorkspaceId ?? '') : workspaceId
  const workspaceReady = hasRunWorkspace
    ? Boolean(runWorkspaceReady)
    : Boolean(selectedWorkspace && isWorkspaceReady(selectedWorkspace.status))
  const workspaceStatus = hasRunWorkspace
    ? runWorkspaceStatus
    : selectedWorkspace?.status

  const dismiss = (fp: string) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(fp)
      persistDismissedProposals(runId, next)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {hasRunWorkspace ? (
        <p className="text-ui-sm text-tier-tertiary">
          Installing into{' '}
          <span className="text-tier-secondary">
            {projectName ?? 'project'}
            {workspaceLabel ? ` / ${workspaceLabel}` : ''}
          </span>
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-chrome/50 p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Install into workspace
          </p>
          <WorkspacePicker
            projectId={projectId}
            workspaceId={workspaceId}
            onChange={({ projectId: pid, workspaceId: wid }) => {
              setProjectId(pid)
              setWorkspaceId(wid)
            }}
          />
          {!hasWorkspaceId(workspaceId) ? (
            <p className="mt-2 text-ui-sm text-tier-tertiary">
              This planner run has no workspace — pick one to activate proposals.
            </p>
          ) : null}
        </div>
      )}

      <PlanProposalList
        proposals={proposals}
        runtimeId={runtimeId}
        workspaceId={effectiveWorkspaceId}
        workspaceReady={workspaceReady}
        workspaceStatus={workspaceStatus}
        runId={runId}
        dismissed={dismissed}
        onDismiss={dismiss}
        installed={installed}
        onInstalled={(fp, state) => setInstalled((prev) => ({ ...prev, [fp]: state }))}
        compact
      />
    </div>
  )
}
