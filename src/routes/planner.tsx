import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2, Sparkles, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import * as fns from '../fns'
import type { PlanProposal } from '../lib/planProposals'
import {
  PlanProposalList,
  type ProposalInstallState,
} from '../components/PlanProposalCard'
import { RuntimePicker } from '../components/ComposerControls'
import { NeedProjectEmpty } from '../components/NeedProjectEmpty'
import { Button, Card, Field, inputClass } from '../components/ui'
import { WorkspacePicker } from '../components/WorkspacePicker'
import { hasProjects } from '../lib/projectGate'
import { pickDefaultRuntime } from '../lib/pickRuntime'
import {
  loadDismissedProposals,
  persistDismissedProposals,
} from '../lib/planProposalDismiss'
import { useProjects, useRuntimes, useWorkspaces } from '../lib/queries'
import { hasWorkspaceId, missingWorkspaceMessage } from '../lib/workspaceRef'
import { isWorkspaceReady, workspaceNotReadyMessage } from '../lib/workspaceReady'

export const Route = createFileRoute('/planner')({ component: PlannerPage })

const EXAMPLES = [
  'Keep my open-source repo healthy: triage new issues, review dependency updates, and summarize activity.',
  'Every morning, review yesterday’s git commits in ~/projects/api and write a risk report.',
  'Watch a docs folder and regenerate the changelog and table of contents when things change.',
]

function PlannerPage() {
  const { data: runtimes } = useRuntimes()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const navigate = useNavigate()

  const [objective, setObjective] = useState('')
  const [runtimeId, setRuntimeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [proposals, setProposals] = useState<PlanProposal[] | null>(null)
  const [raw, setRaw] = useState('')
  const [runId, setRunId] = useState('')
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const [installed, setInstalled] = useState<Record<string, ProposalInstallState>>({})
  const { data: workspaces } = useWorkspaces(projectId || undefined)

  useEffect(() => {
    if (runtimeId || !runtimes?.length) return
    const preferred = pickDefaultRuntime(runtimes)
    if (preferred) setRuntimeId(preferred.id)
  }, [runtimes, runtimeId])

  useEffect(() => {
    if (!runId) return
    setDismissed(loadDismissedProposals(runId))
  }, [runId])

  const selectedWorkspace = useMemo(
    () => workspaces?.find((w) => w.id === workspaceId),
    [workspaces, workspaceId],
  )
  const workspaceReady = Boolean(
    selectedWorkspace && isWorkspaceReady(selectedWorkspace.status),
  )

  const generate = async () => {
    if (!objective.trim()) return
    if (!hasWorkspaceId(workspaceId) || !workspaceReady) return
    setLoading(true)
    setProposals(null)
    setRaw('')
    setInstalled({})
    try {
      const res = await fns.planObjective({
        data: { objective, runtimeId, workspaceId },
      })
      setProposals(res.proposals)
      setRaw(res.raw)
      setRunId(res.runId)
      setDismissed(loadDismissedProposals(res.runId))
    } finally {
      setLoading(false)
    }
  }

  const dismiss = (fp: string) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(fp)
      if (runId) persistDismissedProposals(runId, next)
      return next
    })
  }

  const markInstalled = (fp: string, state: ProposalInstallState) => {
    setInstalled((prev) => ({ ...prev, [fp]: state }))
  }

  const selectedRuntime = runtimes?.find((r) => r.id === runtimeId)

  if (!projectsLoading && !hasProjects(projects?.length ?? 0)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-ui-lg text-foreground">
            <Sparkles className="h-4 w-4 text-tier-tertiary" /> Planner
          </h1>
          <p className="mt-1 max-w-2xl text-ui-base text-tier-tertiary">
            Describe a goal. A local agent CLI drafts scheduled automations — after you add a
            project for them to run in.
          </p>
        </header>
        <NeedProjectEmpty />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-ui-lg text-foreground">
          <Sparkles className="h-4 w-4 text-tier-tertiary" /> Planner
        </h1>
        <p className="mt-1 max-w-2xl text-ui-base text-tier-tertiary">
          Describe a goal. A local agent CLI drafts scheduled automations you can save &amp;
          activate or ignore one by one.
        </p>
      </header>

      <Card className="p-5">
        <Field label="Objective">
          <textarea
            className={`${inputClass} min-h-24`}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="What should your agents accomplish, and roughly how often?"
          />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setObjective(ex)}
              className="rounded-md border border-border bg-[var(--bg-quaternary)] px-2 py-1 text-left text-[11px] text-tier-secondary hover:bg-active hover:text-foreground"
            >
              {ex.length > 52 ? ex.slice(0, 52) + '…' : ex}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <Field label="Planning runtime">
            <div className="flex items-center rounded-lg border border-border bg-[var(--bg-luminous-quaternary)] px-2 py-1.5">
              {runtimes && runtimes.length > 0 ? (
                <RuntimePicker
                  runtimes={runtimes}
                  runtimeId={runtimeId}
                  align="start"
                  onChange={setRuntimeId}
                />
              ) : (
                <span className="px-2.5 text-ui-base text-tier-quaternary">No runtimes configured</span>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-4">
          <WorkspacePicker
            projectId={projectId}
            workspaceId={workspaceId}
            onChange={({ projectId: pid, workspaceId: wid }) => {
              setProjectId(pid)
              setWorkspaceId(wid)
            }}
          />
          {!hasWorkspaceId(workspaceId) ? (
            <p className="mt-1.5 text-ui-sm text-tier-tertiary">{missingWorkspaceMessage()}</p>
          ) : selectedWorkspace && !workspaceReady ? (
            <p className="mt-1.5 text-ui-sm text-tier-tertiary">
              {workspaceNotReadyMessage(selectedWorkspace.status)}
            </p>
          ) : null}
        </div>

        {selectedRuntime && !selectedRuntime.installed ? (
          <p className="mt-3 rounded-md border border-border px-3 py-2 text-ui-sm text-tier-secondary">
            <code className="mono">{selectedRuntime.bin}</code> isn’t on PATH. Install it or pick
            another runtime that is installed.
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="primary"
            onClick={generate}
            disabled={
              loading ||
              !objective.trim() ||
              !hasWorkspaceId(workspaceId) ||
              !workspaceReady
            }
            title={
              !hasWorkspaceId(workspaceId)
                ? missingWorkspaceMessage()
                : !workspaceReady
                  ? workspaceNotReadyMessage(selectedWorkspace?.status)
                  : undefined
            }
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {loading ? 'Planning…' : 'Generate plan'}
          </Button>
          {loading ? (
            <span className="text-ui-sm text-tier-tertiary">
              running <code className="mono">{selectedRuntime?.bin}</code> locally — this can take a
              minute
            </span>
          ) : null}
        </div>
      </Card>

      {proposals ? (
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-tier-secondary">
              Proposed automations{' '}
              <span className="text-tier-tertiary">({proposals.length})</span>
            </h2>
            {runId ? (
              <button
                onClick={() => navigate({ to: '/runs/$runId', params: { runId } })}
                className="text-xs text-tier-secondary underline underline-offset-2 hover:text-foreground"
              >
                Open planner run →
              </button>
            ) : null}
          </div>

          {proposals.length === 0 ? (
            <Card className="p-5">
              <p className="text-ui-base text-tier-secondary">
                Couldn’t parse a plan from the agent output. Here’s the raw response:
              </p>
              <pre className="scroll-thin mt-3 max-h-64 overflow-auto rounded-lg border border-[var(--border-quaternary)] bg-black/50 p-3 mono text-[12px] text-tier-secondary">
                {raw || '— empty —'}
              </pre>
            </Card>
          ) : (
            <PlanProposalList
              proposals={proposals}
              runtimeId={runtimeId}
              workspaceId={workspaceId}
              workspaceReady={workspaceReady}
              workspaceStatus={selectedWorkspace?.status}
              runId={runId}
              dismissed={dismissed}
              onDismiss={dismiss}
              installed={installed}
              onInstalled={markInstalled}
            />
          )}
        </section>
      ) : null}
    </div>
  )
}
