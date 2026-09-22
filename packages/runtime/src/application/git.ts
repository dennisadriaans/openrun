/** git capability implementation. */
import {
  getRunEnvironment,
  releasedResult,
  resultFileDiff,
  resultFile,
  resultDirectory,
  ensureRunEnvironment,
  releaseRunEnvironment,
  usingRunEnvironment,
} from '../execution/runEnvironment.ts'
import {
  buildShipPlanPrompt,
  commitMessageText,
  fallbackShipPlan,
  parseShipPlan,
  shipPlanProblem,
  type ShipPlan,
} from '@openrun/domain/workspaces/shipPlan'
import { shipBlockedReason } from '@openrun/domain/workspaces/gitActionGate'
import type { RuntimeRow, RunRow } from '../storage/db.ts'
import { startRun } from '../execution/executor.ts'
import * as files from '../workspaces/files.ts'
import * as git from '../workspaces/git.ts'
import { runtimeKind } from '../execution/resume.ts'
import { getProject, getWorkspace, resolveWorkspacePath } from '../workspaces/workspaces.ts'
import { saveAttachment } from '../workspaces/attachments.ts'
import { getRun } from './runs.ts'
import { invalidateRunPullRequest } from './conversation.ts'
import { getRuntime } from './runtimes.ts'

import { waitForRun } from './planner.ts'

function runCwd(runId: string): string {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  ensureRunEnvironment(runId)
  return run.cwd
}

export function getFileDiff(input: { runId: string; path: string; whole?: boolean }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  // `whole` widens the context until the file's hunks merge into one, so the
  // viewer can show a change surrounded by the rest of the file. Hunk indices
  // differ between the two, so per-hunk undo is only offered on the default.
  const context = input.whole ? git.WHOLE_FILE_CONTEXT : undefined
  return {
    path: input.path,
    whole: !!input.whole,
    diff: releasedResult(input.runId)
      ? resultFileDiff(releasedResult(input.runId)!.env, input.path, context)
      : git.fileDiff(run.cwd, input.path, run.baseSnapshot || undefined, context),
  }
}

export function listWorkspaceFiles(input: { runId: string; dir?: string }) {
  const saved = releasedResult(input.runId)
  return {
    entries: saved
      ? resultDirectory(saved.env, input.dir ?? '')
      : files.listDirectory(runCwd(input.runId), input.dir ?? ''),
  }
}

export function readWorkspaceFile(input: { runId: string; path: string }) {
  const saved = releasedResult(input.runId)
  return saved
    ? resultFile(saved.env, input.path)
    : files.readWorkspaceFile(runCwd(input.runId), input.path)
}

export function writeWorkspaceFile(input: { runId: string; path: string; content: string }) {
  return files.writeWorkspaceFile(runCwd(input.runId), input.path, input.content)
}

export function restoreWorkspaceFile(input: { runId: string; path: string; content: string }) {
  return files.putWorkspaceFile(runCwd(input.runId), input.path, input.content)
}

/**
 * Write a composer image into the workspace so the agent can read it.
 *
 * Keyed by workspace, not by run: the first message of a new chat is composed
 * before a run exists.
 */
export function saveWorkspaceAttachment(input: {
  runId?: string
  workspaceId: string
  name: string
  mimeType: string
  data: string
}) {
  const cwd = input.runId ? runCwd(input.runId) : resolveWorkspacePath(input.workspaceId)
  return saveAttachment({ cwd, name: input.name, mimeType: input.mimeType, data: input.data })
}

/**
 * Paths still dirty vs HEAD that are also part of the run delta. Used so
 * commit only stages run-owned changes (already-committed mid-run work is
 * skipped; pre-existing dirt outside the delta is skipped).
 */
function commitableRunPaths(
  run: { cwd: string; baseSnapshot: string },
  paths?: string[],
): string[] | undefined {
  if (!run.baseSnapshot) return paths

  const delta = new Set(git.changedFiles(run.cwd, run.baseSnapshot).map((f) => f.path))
  const dirtyVsHead = new Set(git.changedFiles(run.cwd).map((f) => f.path))
  const scoped = [...delta].filter((p) => dirtyVsHead.has(p))
  if (paths && paths.length > 0) {
    return paths.filter((p) => scoped.includes(p))
  }
  return scoped
}

export function commitChanges(input: { runId: string; message: string; paths?: string[] }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  ensureRunEnvironment(input.runId)
  const paths = commitableRunPaths(run, input.paths)
  if (run.baseSnapshot && (!paths || paths.length === 0)) {
    throw new Error('Nothing staged to commit')
  }
  const result = git.commit(run.cwd, input.message, paths)
  releaseRunEnvironment(input.runId)
  return result
}

export function pushChanges(input: { runId: string }) {
  return usingRunEnvironment(input.runId, () => git.push(runCwd(input.runId)))
}

/**
 * Undo a run's work. Files always go back to the base snapshot; `resetCommits`
 * additionally walks the branch back to where the run found it, which is the
 * only way the tree and `git log` end up telling the same story.
 *
 * Files first, then the branch: the restore is computed against the snapshot
 * tree, and doing it while the commits are still on HEAD keeps that delta the
 * same one the user reviewed.
 */
export function discardChanges(input: { runId: string; paths?: string[]; resetCommits?: boolean }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  ensureRunEnvironment(input.runId)
  if (input.resetCommits && input.paths && input.paths.length > 0) {
    throw new Error('Dropping commits undoes the whole run, so it cannot be scoped to files')
  }

  const discarded = git.discard(run.cwd, input.paths, run.baseSnapshot || undefined)
  if (!input.resetCommits) {
    releaseRunEnvironment(input.runId)
    return { ...discarded, commitsDropped: 0, previousHead: '' }
  }

  const reset = git.resetRunCommits(run.cwd, run.baseSnapshot || '')
  releaseRunEnvironment(input.runId)
  return { ...discarded, commitsDropped: reset.dropped, previousHead: reset.previousHead }
}

export function discardHunk(input: { runId: string; path: string; hunkIndex: number }) {
  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')
  ensureRunEnvironment(input.runId)
  const since = run.baseSnapshot || undefined
  const delta = git.changedFiles(run.cwd, since)
  if (!delta.some((file) => file.path === input.path)) {
    throw new Error("File is not part of this run's changes")
  }
  return git.discardHunk(run.cwd, input.path, input.hunkIndex, since)
}

export function createBranch(input: { runId: string; name: string }) {
  return git.createBranch(runCwd(input.runId), input.name)
}

export async function openPullRequest(input: {
  runId: string
  title: string
  body: string
  base?: string
}) {
  return usingRunEnvironment(input.runId, async () => {
    const run = getRun(input.runId)
    if (!run) throw new Error('Run not found')
    ensureRunEnvironment(input.runId)

    // Default an unspecified base to the *project's* default branch, not just
    // "whatever git would pick" — a worktree is typically branched off another
    // worktree's in-progress branch (fromBranch), and that branch was never
    // pushed to origin. Opening a PR against it would fail or target a branch
    // the reviewer can't see. The project's defaultBranch is always a real,
    // pushed branch, so it's the only safe default.
    let base = input.base
    if (!base) {
      const workspace = run.workspaceId ? getWorkspace(run.workspaceId) : undefined
      const project = workspace ? getProject(workspace.projectId) : undefined
      const executionBase = getRunEnvironment(input.runId)?.baseRef
      base =
        executionBase && !/^[a-f0-9]{40,64}$/.test(executionBase)
          ? executionBase
          : project?.defaultBranch
    }

    // Await before invalidating: the cache must only be dropped once a PR
    // actually exists, or the next probe re-reads and re-caches "no PR".
    const result = await git.createPullRequest({
      cwd: run.cwd,
      title: input.title,
      body: input.body,
      base,
    })
    invalidateRunPullRequest(input.runId)
    return result
  })
}

/** How much diff context the planning turn is given before it is truncated. */
const SHIP_DIFF_BUDGET = 60_000

/** How long to wait for the grouping answer before falling back to one commit. */
const SHIP_PLAN_TIMEOUT_MS = 180_000

export type ShipStep = 'plan' | 'commit' | 'push' | 'pull-request'

export type ShipRunResult = {
  /** Commits actually created, in the order they landed. */
  commits: { message: string; sha: string; paths: string[] }[]
  branch: string
  url: string
  prTitle: string
  /** Set when the agent's plan was unusable and the fallback ran instead. */
  planFallbackReason?: string
}

/**
 * Ask the run's runtime to group the diff. Returns `null` (never throws) when
 * the CLI is unreachable or answers unusably — the caller falls back to a
 * single commit rather than refusing to ship.
 */
async function requestShipPlan(input: {
  run: RunRow
  files: git.DiffFile[]
  diff: string
}): Promise<{ plan: ShipPlan | null; reason: string }> {
  const runtime = getRuntime(input.run.runtimeId)
  if (!runtime) return { plan: null, reason: 'The run has no runtime to plan with' }

  const kind = runtimeKind(runtime.bin)
  // The same single-shot plain-text shape the planner uses: one cheap answer,
  // no session, no stream-json. A runtime normally driven over ACP takes the
  // CLI path here for exactly that reason.
  const args =
    kind === 'codex'
      ? ['exec', '--skip-git-repo-check', '-']
      : kind === 'grok'
        ? ['--prompt-file', '{promptFile}', '--output-format', 'plain', '--always-approve']
        : kind === 'fx'
          ? ['ask', '--yolo']
          : ['-p', '--output-format', 'text', '--dangerously-skip-permissions']

  const planRuntime: RuntimeRow = {
    ...runtime,
    // The planning turn must not open a PR of its own — this function does.
    canOpenPrs: 0,
    transport: 'cli',
    promptViaStdin: kind === 'grok' ? 0 : 1,
    argsTemplate: JSON.stringify(args),
  }

  const prompt = buildShipPlanPrompt({
    files: input.files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
    diff: input.diff,
    taskName: input.run.taskName ?? '',
    baseBranch: input.run.baseBranch ?? '',
  })

  let planRunId: string
  try {
    planRunId = startRun({
      runtime: planRuntime,
      taskId: null,
      taskName: `Ship: ${input.run.taskName || input.run.id}`,
      prompt,
      // Read-only planning: it inspects a diff it was handed, so it stays in
      // the app cwd and never takes the run's workspace lock.
      cwd: process.cwd(),
      workspaceId: input.run.workspaceId || '',
      lockWorkspace: false,
      trigger: 'planner',
      // The run's own picker settings — shipping speaks in the voice the user
      // chose for the work.
      model: input.run.model,
      effort: input.run.effort,
    })
  } catch (err) {
    return {
      plan: null,
      reason: err instanceof Error ? err.message : 'Could not start the planner',
    }
  }

  const raw = await waitForRun(planRunId, SHIP_PLAN_TIMEOUT_MS)
  const plan = parseShipPlan(raw)
  if (!plan) return { plan: null, reason: 'The agent did not return a usable commit plan' }

  const problem = shipPlanProblem(
    plan,
    input.files.map((f) => f.path),
  )
  if (problem) return { plan: null, reason: problem }
  return { plan, reason: '' }
}

/**
 * Commit → push → open PR in one call.
 *
 * Ordered so a failure leaves the least mess: the plan is validated against
 * the real file list before the first `git commit`, and the PR is opened only
 * once the branch is actually on origin.
 */
export async function shipRun(input: {
  runId: string
  /** Override the base branch; defaults the same way `openPullRequest` does. */
  base?: string
  /** Skip the agent and commit everything as one conventional commit. */
  skipPlan?: boolean
}): Promise<ShipRunResult> {
  return usingRunEnvironment(input.runId, async () => {
    const run = getRun(input.runId)
    if (!run) throw new Error('Run not found')

    const gh = git.ghStatus()
    const info = git.repoInfo(run.cwd)
    const files = git.changedFiles(run.cwd, run.baseSnapshot || undefined)
    // Only run-owned paths that are still dirty can be committed; anything the
    // run already committed mid-flight is carried by `ahead` instead.
    const committable = new Set(commitableRunPaths(run) ?? files.map((f) => f.path))
    const pending = files.filter((f) => committable.has(f.path))

    const blocked = shipBlockedReason({
      hasRemote: Boolean(info.remote),
      ghInstalled: gh.installed,
      ghAuthenticated: gh.authenticated,
      hasChanges: pending.length > 0,
      ahead: info.ahead,
    })
    if (blocked) throw new Error(blocked)

    let plan: ShipPlan | null = null
    let planFallbackReason = ''
    if (pending.length > 0) {
      if (!input.skipPlan) {
        const asked = await requestShipPlan({
          run,
          files: pending,
          diff: git.changedDiff(run.cwd, run.baseSnapshot || undefined, SHIP_DIFF_BUDGET),
        })
        plan = asked.plan
        planFallbackReason = asked.reason
      }
      if (!plan) {
        plan = fallbackShipPlan({
          taskName: run.taskName ?? '',
          changed: pending.map((f) => f.path),
        })
      }
    }

    // Commit. Each group is staged by path, so a plan that groups by feature
    // produces a history that reads by feature.
    const commits: ShipRunResult['commits'] = []
    for (const entry of plan?.commits ?? []) {
      const result = git.commit(run.cwd, commitMessageText(entry), entry.paths)
      commits.push({ message: entry.message, sha: result.sha, paths: entry.paths })
    }

    const pushed = await git.push(run.cwd)

    // Title the PR from the plan when there is one; a ship that only pushes
    // existing commits falls back to the run's own name.
    const title =
      plan?.prTitle || fallbackShipPlan({ taskName: run.taskName ?? '', changed: [] }).prTitle
    const body =
      plan?.prBody ||
      `## Summary\n- ${run.taskName || 'Changes produced by an Open Run run.'}\n\n## Test plan\n- [ ] Review the diff and exercise the affected surface`

    const pr = await openPullRequest({ runId: input.runId, title, body, base: input.base })

    return {
      commits,
      branch: pushed.branch,
      url: pr.url,
      prTitle: title,
      ...(planFallbackReason ? { planFallbackReason } : {}),
    }
  })
}
