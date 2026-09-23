/** planner capability implementation. */
import { assertWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import { assertWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import { parsePlanProposals, type PlanProposal } from '@openrun/domain/tasks/planProposals'
import { getDb, type RuntimeRow } from '../storage/db.ts'
import { startRun } from '../execution/executor.ts'
import { runtimeKind } from '../execution/resume.ts'
import { getWorkspace, resolveWorkspacePath } from '../workspaces/workspaces.ts'
import { getRuntime } from './runtimes.ts'
import type { TaskWithMeta } from './taskQueries.ts'
import { upsertTask } from './taskCommands.ts'

export type { PlanProposal }

function buildPlannerPrompt(objective: string): string {
  return `You are an automation planner. Break the goal below into a small set of
concrete recurring automations that a local coding-agent CLI could run unattended.
Do not use tools, edit files, or explore the filesystem — answer from the goal alone.

${objective}

Respond with ONLY a JSON array (no prose, no markdown fences). Each element must be:
{ "name": string, "description": string, "prompt": string, "cron": string }
- "prompt" is the full concrete instruction handed to the agent at run time — write
  the real task text, not a placeholder or a reference to "the objective" / "the goal".
- "cron" is a standard 5-field cron expression for when it should run.
Return 2-5 automations.`
}

export async function planObjective(input: {
  objective: string
  runtimeId: string
  /** Workspace proposals will install into — required. */
  workspaceId: string
}): Promise<{ proposals: PlanProposal[]; raw: string; runId: string }> {
  const runtime = getRuntime(input.runtimeId)
  if (!runtime) throw new Error('Runtime not found')

  const objective = input.objective.trim()
  if (!objective) throw new Error('An objective is required')

  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)

  const plannerKind = runtimeKind(runtime.bin)
  const plannerArgs =
    plannerKind === 'codex'
      ? ['exec', '--skip-git-repo-check', '-']
      : plannerKind === 'grok'
        ? ['--prompt-file', '{promptFile}', '--output-format', 'plain', '--always-approve']
        : plannerKind === 'fx'
          ? ['ask', '--yolo']
          : ['-p', '--output-format', 'text', '--dangerously-skip-permissions']
  const plannerRuntime: RuntimeRow = {
    ...runtime,
    canOpenPrs: 0,
    // Planning wants one cheap plain-text answer, which is exactly what the
    // args above ask for — so it always takes the CLI path, even when the
    // runtime is normally driven over ACP.
    transport: 'cli',
    promptViaStdin: plannerKind === 'grok' ? 0 : 1,
    argsTemplate: JSON.stringify(plannerArgs),
  }

  const runId = startRun({
    runtime: plannerRuntime,
    taskId: null,
    taskName: `Planner: ${objective.slice(0, 40)}`,
    // Chat shows the goal; the CLI gets the planning wrapper around it.
    prompt: objective,
    cliPrompt: buildPlannerPrompt(objective),
    cwd: process.cwd(),
    // Remember the install target on the run so chat cards reuse it. The
    // planner CLI itself stays in the app cwd and does not lock the worktree.
    workspaceId,
    lockWorkspace: false,
    trigger: 'planner',
  })

  // Poll the run row until the process finishes (planner is synchronous UX).
  const raw = await waitForRun(runId, 180_000)
  const proposals = parsePlanProposals(raw)
  return { proposals, raw, runId }
}

function waitForRun(runId: string, timeoutMs: number): Promise<string> {
  const db = getDb()
  const start = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      const row = db.prepare('SELECT status, stdout FROM runs WHERE id = ?').get(runId) as
        | { status: string; stdout: string }
        | undefined
      if (!row) return resolve('')
      if (row.status !== 'running' || Date.now() - start > timeoutMs) return resolve(row.stdout)
      setTimeout(tick, 400)
    }
    tick()
  })
}

/** Create one automation from a planner proposal; default arms the schedule. */
export function installPlanProposal(input: {
  runtimeId: string
  workspaceId: string
  proposal: PlanProposal
  /** Defaults to true (Save & activate). */
  enabled?: boolean
}): TaskWithMeta {
  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)
  const enabled = input.enabled !== false
  const cwd = resolveWorkspacePath(workspaceId)
  return upsertTask({
    name: input.proposal.name,
    description: input.proposal.description,
    runtimeId: input.runtimeId,
    prompt: input.proposal.prompt,
    cwd,
    workspaceId,
    cron: input.proposal.cron,
    enabled,
  })
}

export function createTasksFromPlan(input: {
  runtimeId: string
  workspaceId: string
  proposals: PlanProposal[]
  /** Defaults to false (batch create stays paused for review). */
  enabled?: boolean
}): TaskWithMeta[] {
  // Resolve once up front rather than per-proposal — a missing / not-ready
  // workspace should fail the whole batch, not silently create some tasks
  // with a stale cwd and others without.
  const workspaceId = assertWorkspaceId(input.workspaceId)
  const workspace = getWorkspace(workspaceId)
  assertWorkspaceReady(workspace?.status)
  const enabled = input.enabled === true
  const cwd = resolveWorkspacePath(workspaceId)
  return input.proposals.map((p) =>
    upsertTask({
      name: p.name,
      description: p.description,
      runtimeId: input.runtimeId,
      prompt: p.prompt,
      cwd,
      workspaceId,
      cron: p.cron,
      enabled,
    }),
  )
}

// Internal collaborators; the public facade exports only the API surface.
export { waitForRun }
