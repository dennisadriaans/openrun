/**
 * Shared refuse reasons for starting or arming a run — workspace, ready,
 * PATH, prompt — so Enable / Run now / forms cannot drift apart.
 *
 * Cron is intentionally omitted here (Enable-only). Pure and browser-safe.
 */
import { missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { emptyTaskPromptMessage } from './taskPrompt.ts'
import { missingNativeSessionMessage } from './nativeSessions.ts'
import { missingWorkspaceMessage } from './workspaceRef.ts'
import { workspaceNotReadyMessage } from './workspaceReady.ts'
import { workspaceHealthBlockedReason, type WorkspaceHealth } from './workspaceHealth.ts'

/** Fields shared by Run now and (after cron) Enable. */
export type RunPrereqInput = {
  workspaceValid: boolean
  workspaceReady: boolean
  /** Lifecycle status when the workspace row exists; used for ready copy. */
  workspaceStatus?: string | null
  /** Physical on-disk state, when the caller has it. See WorkspaceGateInput. */
  workspaceHealth?: WorkspaceHealth | null
  runtimeInstalled: boolean
  /** Trimmed runtime binary name for PATH-missing copy. */
  runtimeBin?: string
  /** False when the stored prompt is empty / whitespace-only. */
  promptValid: boolean
  /** Native CLI session id to resume; empty means a new conversation. */
  resumeSessionId?: string
  /**
   * False when resumeSessionId is set but the chat is gone from disk (or the
   * runtime cannot resume native chats). Ignored when no id is bound.
   */
  resumeSessionValid?: boolean
}

/** Workspace existence + ready only (save form — PATH is warned elsewhere). */
export type WorkspaceGateInput = {
  workspaceValid: boolean
  workspaceReady: boolean
  workspaceStatus?: string | null
  /**
   * What is physically on disk, when the caller has it. Only the structural
   * codes refuse here — a dirty or drifted tree is something the human
   * pressing the button can see and judge; an absent directory is not.
   */
  workspaceHealth?: WorkspaceHealth | null
}

/**
 * Reason the workspace alone would refuse, or `null` when it is usable.
 * Order matches server assertWorkspaceId → assertWorkspaceReady → the
 * on-disk check in `resolveWorkspacePath`.
 */
export function workspaceBlockedReason(input: WorkspaceGateInput): string | null {
  if (!input.workspaceValid) return missingWorkspaceMessage()
  if (!input.workspaceReady) {
    return workspaceNotReadyMessage(input.workspaceStatus)
  }
  return workspaceHealthBlockedReason(input.workspaceHealth, { unattended: false })
}

/**
 * Reason a run would refuse for workspace / PATH / prompt, or `null` when
 * those gates are green. Order matches `runTaskNow` → `startRun`.
 */
export function runPrereqBlockedReason(input: RunPrereqInput): string | null {
  const workspace = workspaceBlockedReason(input)
  if (workspace) return workspace
  if (!input.runtimeInstalled) {
    return missingRuntimeBinaryMessage(input.runtimeBin ?? '')
  }
  if (!input.promptValid) return emptyTaskPromptMessage()
  if ((input.resumeSessionId ?? '').trim() && input.resumeSessionValid === false) {
    return missingNativeSessionMessage()
  }
  return null
}
