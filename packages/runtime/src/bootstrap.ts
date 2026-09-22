/** One-time process startup and lifecycle wiring. */
import { bootLocalRuntime } from './process/localRuntime.ts'
import {
  collectRunEnvironments,
  migrateAutomationTargets,
  releasedResult,
} from './execution/runEnvironment.ts'
import { reconcileWorkspaces } from './workspaces/workspaces.ts'
import { warmModelCatalogs } from './runtimes/modelCatalog.ts'
import {
  installProcessShutdownHooks,
  reconcileOrphanRuns,
  setRunFinalizedHook,
} from './execution/executor.ts'
import { notifyRunFinished } from './notifications/notify.ts'
import { drainWorkspace } from './execution/runQueue.ts'

import * as git from './workspaces/git.ts'
import { bootScheduler } from './scheduling/scheduler.ts'
import { bootMcpTokenRefresh } from './mcp/mcpOAuth.ts'
import { bootCloud } from './cloud/index.ts'
import { assertServerAccess } from './security/accessToken.ts'
import { getRun } from './application/runs.ts'

assertServerAccess()

bootLocalRuntime()

const bootSafety = globalThis as unknown as { __agentopsSafetyBooted?: boolean }

if (!bootSafety.__agentopsSafetyBooted) {
  bootSafety.__agentopsSafetyBooted = true
  reconcileOrphanRuns()
  installProcessShutdownHooks()
  reconcileWorkspaces()
  migrateAutomationTargets()
  collectRunEnvironments()
  const cleanupTimer = setInterval(collectRunEnvironments, 60_000)
  cleanupTimer.unref()
}

bootScheduler()

warmModelCatalogs()

bootMcpTokenRefresh()

/**
 * Everything that has to happen once a run settles. Registered here rather
 * than imported by the executor: notification and (later) queue draining both
 * need to read tasks/projects, which would be a cycle straight back into the
 * executor.
 */
setRunFinalizedHook((runId) => {
  const run = getRun(runId)
  if (!run) return
  let changed = 0
  try {
    changed =
      releasedResult(runId)?.files.length ??
      git.changedFiles(run.cwd, run.baseSnapshot || undefined).length
  } catch {
    // Non-git or missing cwd — the notification just reports zero.
  }
  notifyRunFinished(runId, changed)
  // The workspace lock just came free — start whatever was waiting on it.
  if (run.workspaceId) drainWorkspace(run.workspaceId)
})

bootCloud()
