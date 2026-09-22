/** workspaceChecks capability implementation. */
import { CHECK_TIMEOUT_MS } from '@openrun/domain/runs/checks'
import { assertWorkspaceId } from '@openrun/domain/workspaces/workspaceRef'
import { workspaceHealthBlockedReason } from '@openrun/domain/workspaces/workspaceHealth'
import { assertWorkspaceReady } from '@openrun/domain/workspaces/workspaceReady'
import { checksForWorkspace, executeCheck } from '../execution/checks.ts'
import {
  blockWorkspace,
  checkWorkspace,
  clearWorkspaceBlock,
} from '../workspaces/workspaceHealth.ts'

import { assertWorkspaceMutationIdle } from './taskQueries.ts'

export type BaselineResult = {
  ok: boolean
  /** Per-check outcomes, in the order they ran. */
  checks: Array<{ name: string; command: string; outcome: string; output: string }>
  /** Refusal or failure summary; empty when the baseline is green. */
  detail: string
}

/**
 * Run the project's verification checks against a workspace *before* anything
 * is armed against it, and record the result as a quarantine when they are
 * red.
 *
 * An automation armed on top of a red baseline cannot produce a trustworthy
 * verdict: its own run comes back `failed-checks` for breakage it did not
 * cause, and the real regression stays invisible. Running the checks once, up
 * front, is what makes "verified" mean something.
 */
export async function runWorkspaceBaseline(workspaceId: string): Promise<BaselineResult> {
  const id = assertWorkspaceId(workspaceId)
  assertWorkspaceMutationIdle(id)
  const checked = checkWorkspace(id)
  if (!checked) throw new Error('Workspace not found')
  assertWorkspaceReady(checked.workspace.status)
  const healthBlock = workspaceHealthBlockedReason(checked.health, { unattended: true })
  if (healthBlock) throw new Error(healthBlock)

  const defs = checksForWorkspace(id)
  if (defs.length === 0) {
    // Nothing configured is not the same as green: leave any existing block
    // alone and say so, rather than silently blessing the workspace.
    return {
      ok: false,
      checks: [],
      detail:
        'This project has no verification checks configured, so there is no baseline to establish. Add checks on the project before arming unattended automations.',
    }
  }

  const outcomes: BaselineResult['checks'] = []
  const failures: string[] = []
  for (const def of defs) {
    const result = await executeCheck({
      command: def.command,
      cwd: checked.workspace.path,
      timeoutMs: CHECK_TIMEOUT_MS,
    })
    outcomes.push({
      name: def.name,
      command: def.command,
      outcome: result.outcome,
      output: result.output,
    })
    if (result.outcome === 'failed' || result.outcome === 'timeout') {
      failures.push(`${def.name} (${def.command}) ${result.outcome}`)
      break
    }
  }

  if (failures.length > 0) {
    const detail = `Baseline is red before any agent has run: ${failures.join('; ')}. Fix the workspace, then re-run the baseline.`
    blockWorkspace(id, 'baseline', detail)
    return { ok: false, checks: outcomes, detail }
  }

  clearWorkspaceBlock(id)
  return { ok: true, checks: outcomes, detail: '' }
}
