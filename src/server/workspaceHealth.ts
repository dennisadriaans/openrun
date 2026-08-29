/**
 * Physical workspace inspection and quarantine.
 *
 * `workspaces.status` records what the app *did* to a workspace, not what is
 * on disk now. A worktree removed by hand, a branch switched by a previous
 * run, or files left behind by a crashed agent all leave the row saying
 * `ready`. An unattended run armed against such a row either dies with spawn
 * ENOENT (there is no cwd to spawn into) or silently inherits another
 * automation's half-finished work — and both failures get reported against
 * the wrong automation.
 *
 * This module answers "is this workspace actually fit to run in right now",
 * marks a workspace broken when the answer is structurally no, and quarantines
 * one whose last unattended run left it in an unknown state.
 *
 * The judgement itself (which codes block which triggers, and the wording) is
 * in `lib/workspaceHealth.ts` so the UI refuses in the same words.
 */
import { existsSync, realpathSync } from 'node:fs'
import {
  isFatalHealth,
  missingWorkspaceDirMessage,
  workspaceHealthMessage,
  type WorkspaceHealth,
  type WorkspaceHealthCode,
} from '../lib/workspaceHealth.ts'
import { getDb, type WorkspaceRow } from './db'
import * as git from './git'
import { getProject, getWorkspace } from './workspaces'

/** macOS hands out /tmp and /private/tmp for the same directory; compare real paths. */
function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function at(
  workspace: WorkspaceRow,
  code: WorkspaceHealthCode,
  extra?: Partial<WorkspaceHealth>,
): WorkspaceHealth {
  return {
    code,
    path: workspace.path,
    configuredBranch: workspace.branch,
    actualBranch: '',
    dirty: false,
    detail: '',
    ...extra,
  }
}

/**
 * What is on disk for this workspace right now. Ordered most-fatal first: a
 * path that is gone cannot be asked for its branch, and a quarantine outranks
 * cosmetic drift because the tree is known to be untrustworthy either way.
 */
export function inspectWorkspaceHealth(workspace: WorkspaceRow): WorkspaceHealth {
  if (!existsSync(workspace.path)) return at(workspace, 'missing')
  if (!git.isRepo(workspace.path)) return at(workspace, 'not-a-worktree')

  // An app-managed worktree must still be registered with its project. A
  // directory that is a repo but no longer a worktree of this project (someone
  // ran `git worktree remove` and re-created the folder, or the project moved)
  // would have the agent committing into a checkout nothing else tracks.
  if (workspace.kind === 'worktree') {
    const project = getProject(workspace.projectId)
    const wanted = canonical(workspace.path)
    const known = project
      ? git.listWorktrees(project.path).some((entry) => canonical(entry.path) === wanted)
      : false
    if (!known) return at(workspace, 'not-a-worktree')
  }

  const info = git.repoInfo(workspace.path)
  const actualBranch = info.branch

  if ((workspace.blockedReason ?? '').trim()) {
    return at(workspace, 'blocked', {
      actualBranch,
      dirty: info.dirty,
      detail: workspace.blockedReason,
    })
  }
  if (!actualBranch || actualBranch === 'HEAD') {
    return at(workspace, 'detached', { actualBranch, dirty: info.dirty })
  }
  if (workspace.branch.trim() && actualBranch !== workspace.branch) {
    return at(workspace, 'branch-drift', { actualBranch, dirty: info.dirty })
  }
  if (info.dirty) return at(workspace, 'dirty', { actualBranch, dirty: true })

  return at(workspace, 'ok', { actualBranch, dirty: false })
}

/**
 * Inspecting a workspace costs three or four `git` child processes, and the
 * automations list re-decorates every row every fifteen seconds. Cache the
 * result briefly so drawing a table of twenty automations does not fork sixty
 * processes, while every gate still calls `inspectWorkspaceHealth` directly
 * and sees the tree as it is at the moment of the decision.
 *
 * Parked on globalThis for the same reason the scheduler is: a Vite hot reload
 * of this module must not silently reset it.
 */
const HEALTH_TTL_MS = 5_000

const g = globalThis as unknown as {
  __openrunWorkspaceHealth?: Map<string, { at: number; value: WorkspaceHealth }>
}

function healthCache(): Map<string, { at: number; value: WorkspaceHealth }> {
  if (!g.__openrunWorkspaceHealth) g.__openrunWorkspaceHealth = new Map()
  return g.__openrunWorkspaceHealth
}

/** Health for display paths — up to `HEALTH_TTL_MS` stale, never used to gate. */
export function cachedWorkspaceHealth(workspace: WorkspaceRow): WorkspaceHealth {
  const cache = healthCache()
  const hit = cache.get(workspace.id)
  const now = Date.now()
  if (hit && now - hit.at < HEALTH_TTL_MS) return hit.value
  const value = inspectWorkspaceHealth(workspace)
  cache.set(workspace.id, { at: now, value })
  return value
}

/** Drop a cached reading — after anything that changes the tree on purpose. */
function forgetHealth(workspaceId: string): void {
  healthCache().delete(workspaceId)
}

/**
 * Demote a workspace whose directory is gone or is no longer a worktree. The
 * row keeps saying `ready` forever otherwise, so the same automation records
 * an ENOENT crash on every fire instead of one visible "this is broken".
 *
 * Only structural damage demotes: drift and dirt are recoverable states that a
 * restore (or a human) fixes without recreating the workspace.
 */
function markWorkspaceBrokenIfNeeded(workspace: WorkspaceRow, health: WorkspaceHealth): void {
  if (!isFatalHealth(health.code)) return
  if (workspace.status === 'error' || workspace.status === 'archived') return
  getDb()
    .prepare("UPDATE workspaces SET status = 'error', setupLog = ? WHERE id = ?")
    .run(workspaceHealthMessage(health), workspace.id)
}

/**
 * Inspect, demote a structurally broken workspace, and hand back both the row
 * and its health so callers gate on one lookup.
 */
export function checkWorkspace(
  workspaceId: string,
): { workspace: WorkspaceRow; health: WorkspaceHealth } | null {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) return null
  const result = inspectWorkspaceHealth(workspace)
  healthCache().set(workspace.id, { at: Date.now(), value: result })
  markWorkspaceBrokenIfNeeded(workspace, result)
  return { workspace, health: result }
}

/**
 * Quarantine a workspace so later unattended fires refuse it instead of
 * inheriting whatever the last run left behind. `kind` records whether it was
 * a bad run or a red verification baseline.
 */
export function blockWorkspace(
  workspaceId: string,
  kind: 'run' | 'baseline',
  reason: string,
): void {
  if (!workspaceId.trim()) return
  getDb()
    .prepare('UPDATE workspaces SET blockedKind = ?, blockedReason = ?, blockedAt = ? WHERE id = ?')
    .run(kind, reason, Date.now(), workspaceId)
  forgetHealth(workspaceId)
}

/** Lift a quarantine — a green run, a green baseline, or an explicit restore. */
export function clearWorkspaceBlock(workspaceId: string): void {
  if (!workspaceId.trim()) return
  getDb()
    .prepare(
      "UPDATE workspaces SET blockedKind = '', blockedReason = '', blockedAt = 0 WHERE id = ?",
    )
    .run(workspaceId)
  forgetHealth(workspaceId)
}

/**
 * Record what a finished unattended run means for its workspace: a verified or
 * clean run lifts any quarantine, anything else raises one. This is what keeps
 * a red build from silently becoming the next automation's starting point —
 * the run that broke it is the run that gets blamed.
 *
 * Attended (chat / Run now) turns are deliberately excluded: a human is
 * looking at the result and does not need the workspace taken away from them.
 */
export function recordRunOutcomeForWorkspace(input: {
  workspaceId: string
  taskName: string
  verdict: string
}): void {
  if (!input.workspaceId.trim()) return
  // Only app-managed worktrees are quarantined. A main checkout belongs to the
  // user — its contents are their business, and the isolation rule already
  // keeps unattended runs out of it unless they explicitly opted in.
  const workspace = getWorkspace(input.workspaceId)
  if (workspace?.kind !== 'worktree') return
  const recoverable = input.verdict === 'verified' || input.verdict === 'no-changes'
  if (recoverable) {
    clearWorkspaceBlock(input.workspaceId)
    return
  }
  if (input.verdict === '' || input.verdict === 'unverified') return

  blockWorkspace(
    input.workspaceId,
    input.verdict === 'failed-checks' ? 'baseline' : 'run',
    `Quarantined after "${input.taskName}" ended as ${input.verdict}. The workspace may still hold that run's changes, so a later unattended run would inherit them. Restore or clear it once you have reviewed the diff.`,
  )
}

export type RestoreResult = {
  branch: string
  /** True when the tree actually had something to throw away. */
  discarded: boolean
}

/**
 * Put an app-managed worktree back on its configured branch with a clean tree
 * and lift its quarantine.
 *
 * Never touches a `kind='main'` workspace: that is the user's own checkout,
 * and a hard reset there would delete work this app did not create.
 */
export function restoreWorkspace(workspaceId: string): RestoreResult {
  const workspace = getWorkspace(workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  if (workspace.kind === 'main') {
    throw new Error(
      'Cannot restore the main checkout — it is your own working copy. Commit or discard its changes yourself.',
    )
  }
  const active = getDb()
    .prepare("SELECT id FROM runs WHERE workspaceId = ? AND status = 'running'")
    .get(workspaceId) as { id: string } | undefined
  if (active) throw new Error('Cannot restore a workspace with a run in progress')
  if (!existsSync(workspace.path)) throw new Error(missingWorkspaceDirMessage(workspace.path))

  const discarded = git.repoInfo(workspace.path).dirty
  git.resetWorktree(workspace.path, workspace.branch)
  clearWorkspaceBlock(workspaceId)
  forgetHealth(workspaceId)
  // A restore repairs whatever demoted the row to 'error' short of the
  // directory being gone, which the guard above already refused.
  getDb().prepare("UPDATE workspaces SET status = 'ready' WHERE id = ?").run(workspaceId)

  return { branch: workspace.branch, discarded }
}
