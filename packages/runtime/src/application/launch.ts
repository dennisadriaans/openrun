/** launch capability implementation. */
import { getRunEnvironment } from '../execution/runEnvironment.ts'
import { assertWorkspaceReady, isWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import {
  emptyChatPromptMessage,
  missingRuntimeMessage,
  runtimeStartBlockedReason,
  workspaceStartBlockedReason,
} from '@openrun/domain/runs/startChatGate'
import {
  defaultEffort,
  defaultModel,
  modelsForRuntime,
  type ModelOption,
} from '@openrun/domain/runtimes/models'
import { getDb } from '../storage/db.ts'
import {
  adoptNativeChat as _adoptNativeChat,
  listMessages,
  startRun,
} from '../execution/executor.ts'
import { checkRuntimeInstalled } from '../runtimes/runtimePath.ts'
import { getProject, getWorkspace, listWorkspaces } from '../workspaces/workspaces.ts'
import { cachedWorkspaceHealth } from '../workspaces/workspaceHealth.ts'

import { listRuntimes, getRuntime } from './runtimes.ts'
import { getRun } from './runs.ts'

/** Most recent non-archived run in a workspace, or null when none exist yet. */
export function getLatestRunForWorkspace(workspaceId: string): { id: string } | null {
  const row = getDb()
    .prepare(
      'SELECT id FROM runs WHERE workspaceId = ? AND archivedAt IS NULL ORDER BY startedAt DESC LIMIT 1',
    )
    .get(workspaceId) as { id: string } | undefined
  return row ?? null
}

/** Most recent non-archived run in any of a project's worktrees. */
export function getLatestRunForProject(projectId: string): { id: string } | null {
  const row = getDb()
    .prepare(
      `SELECT r.id FROM runs r
       JOIN workspaces w ON w.id = r.workspaceId
       WHERE w.projectId = ? AND r.archivedAt IS NULL
       ORDER BY r.startedAt DESC LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined
  return row ?? null
}

/** Start an ad-hoc chat run in a workspace — no task/automation required. */
/**
 * Everything a picker needs to open an empty conversation: the worktrees that
 * could host it and the runtimes that could drive it, each carrying the reason
 * it cannot — from `lib/startChatGate.ts`, so a greyed-out row explains itself
 * with the sentence `startChat` would have thrown.
 *
 * Archived workspaces and disabled runtimes are dropped rather than listed as
 * blocked: they are not choices a user is weighing, they are gone.
 */
export type StartRunWorkspaceOption = {
  id: string
  projectId: string
  projectName: string
  name: string
  branch: string
  kind: 'main' | 'worktree' | 'external'
  status: 'creating' | 'ready' | 'error' | 'archived'
  /** Set while another run holds this worktree. */
  activeRunId: string | null
  blockedReason: string | null
}

export type StartRunRuntimeOption = {
  id: string
  label: string
  bin: string
  transport: string
  installed: boolean
  models: ModelOption[]
  /** Slug the composer should preselect; empty when the catalog is empty. */
  defaultModel: string
  defaultEffort: string
  blockedReason: string | null
}

export function startRunOptions(): {
  workspaces: StartRunWorkspaceOption[]
  runtimes: StartRunRuntimeOption[]
} {
  const workspaces = listWorkspaces()
    .filter((workspace) => workspace.status !== 'archived')
    .map((workspace) => {
      // Read, never repair: `decorate` documents why drawing a list must not
      // demote a row, and the same holds here.
      const health = cachedWorkspaceHealth(workspace)
      return {
        id: workspace.id,
        projectId: workspace.projectId,
        projectName: workspace.projectName,
        name: workspace.name,
        branch: workspace.actualBranch || workspace.branch,
        kind: workspace.kind,
        status: workspace.status,
        activeRunId: workspace.activeRunId,
        blockedReason: workspaceStartBlockedReason({
          workspaceValid: true,
          workspaceReady: isWorkspaceReady(workspace.status),
          workspaceStatus: workspace.status,
          workspaceHealth: health,
          activeRunId: workspace.activeRunId,
        }),
      }
    })

  const runtimes = listRuntimes()
    .filter((runtime) => runtime.enabled === 1)
    .map((runtime) => {
      const installed = checkRuntimeInstalled(runtime.bin).installed
      const models = modelsForRuntime(runtime)
      const preselected = defaultModel(models)
      return {
        id: runtime.id,
        label: runtime.label,
        bin: runtime.bin,
        transport: runtime.transport,
        installed,
        models,
        defaultModel: preselected?.slug ?? '',
        defaultEffort: defaultEffort(preselected),
        blockedReason: runtimeStartBlockedReason({
          runtimeValid: true,
          runtimeInstalled: installed,
          runtimeBin: runtime.bin,
        }),
      }
    })

  return { workspaces, runtimes }
}

export function startChat(input: {
  workspaceId: string
  runtimeId: string
  prompt: string
  model?: string
  effort?: string
  runtimeMode?: string
  resumeSessionId?: string
  resumeSessionLabel?: string
}): { runId: string } {
  const workspace = getWorkspace(input.workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  assertWorkspaceReady(workspace.status)
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error(emptyChatPromptMessage())

  const runtime = getRuntime(input.runtimeId)
  if (!runtime) throw new Error(missingRuntimeMessage())

  const runId = startRun({
    runtime,
    taskId: null,
    taskName: `Chat · ${getProject(workspace.projectId)?.name ?? workspace.branch}`,
    prompt,
    cwd: '',
    workspaceId: workspace.id,
    trigger: 'chat',
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
    resumeSessionId: input.resumeSessionId,
    resumeSessionLabel: input.resumeSessionLabel,
  })
  return { runId }
}

/** Repeat the opening task without reusing an earlier execution directory. */
export function repeatRun(runId: string): { runId: string } {
  const run = getRun(runId)
  if (!run) throw new Error('Run not found')
  if (run.status === 'running') throw new Error('Wait for this run to finish before repeating it.')
  const runtime = getRuntime(run.runtimeId)
  if (!runtime) throw new Error('Runtime not found')
  const prompt = listMessages(runId)
    .find((m) => m.role === 'user')
    ?.content.trim()
  if (!prompt) throw new Error('This run has no opening prompt to repeat.')
  const env = getRunEnvironment(runId)
  return {
    runId: startRun({
      runtime,
      taskId: run.taskId,
      taskName: run.taskName,
      prompt,
      cwd: run.cwd,
      workspaceId: run.workspaceId,
      trigger: env ? 'manual' : 'chat',
      ...(env ? { executionBaseRef: env.baseCommit, isolated: true } : {}),
      model: run.model,
      effort: run.effort,
      runtimeMode: run.runtimeMode,
    }),
  }
}

/**
 * Open a saved CLI chat as a run — history only, no turn executed.
 *
 * The composer in the run that comes back is what starts the first real turn,
 * so browsing an old conversation never costs a model call.
 */
export function openNativeChat(input: {
  workspaceId: string
  runtimeId: string
  sessionId: string
  sessionLabel?: string
  model?: string
  effort?: string
  runtimeMode?: string
}): { runId: string } {
  const workspace = getWorkspace(input.workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  assertWorkspaceReady(workspace.status)

  const runtime = getRuntime(input.runtimeId)
  if (!runtime) throw new Error('Runtime not found')

  const runId = _adoptNativeChat({
    runtime,
    taskName: `Chat · ${workspace.branch}`,
    workspaceId: workspace.id,
    cwd: '',
    sessionId: input.sessionId,
    sessionLabel: input.sessionLabel ?? '',
    model: input.model,
    effort: input.effort,
    runtimeMode: input.runtimeMode,
  })
  return { runId }
}
