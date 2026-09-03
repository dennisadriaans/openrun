/**
 * Why "Start a run" would refuse — the shared rule module behind an empty
 * conversation, wherever it is started from.
 *
 * Mirrors `core.startChat` → `executor.startRun` in the order those refuse:
 * the workspace exists → is ready → is physically fit → is not already busy,
 * then the runtime resolves → is on PATH, then there is a first message. A
 * caller that renders one of these sentences is showing the words the server
 * would have thrown after the tap, not a second opinion about them.
 *
 * The two halves are exported separately because a picker needs them
 * separately: a workspace row can be unusable on its own (busy, quarantined)
 * and a runtime row can be unusable on its own (not installed), and a list has
 * to grey out the right one.
 *
 * Browser-safe and dependency-free like everything in `lib/`.
 */
import { missingRuntimeBinaryMessage } from './runtimeBinary.ts'
import { workspaceBlockedReason, type WorkspaceGateInput } from './runPrereqGate.ts'

/** A workspace row, as far as starting a run is concerned. */
export type WorkspaceStartInput = WorkspaceGateInput & {
  /** id of a run already holding this worktree; empty / null when free. */
  activeRunId?: string | null
}

/** A runtime row, as far as starting a run is concerned. */
export type RuntimeStartInput = {
  /** False when the chosen runtime id no longer resolves to a row. */
  runtimeValid: boolean
  runtimeInstalled: boolean
  /** Trimmed binary name, for the PATH-missing copy. */
  runtimeBin?: string
}

export type StartChatGateInput = WorkspaceStartInput &
  RuntimeStartInput & {
    /** False when the composer is empty or whitespace-only. */
    promptValid: boolean
  }

/** What `assertWorkspaceFree` throws. */
export function workspaceBusyMessage(): string {
  return 'This workspace already has a run in progress'
}

/** What `startChat` throws when the runtime id does not resolve. */
export function missingRuntimeMessage(): string {
  return 'Runtime not found'
}

/** What `startChat` throws on an empty opening message. */
export function emptyChatPromptMessage(): string {
  return 'A first message is required'
}

/** Reason this workspace cannot take a new run, or `null` when it can. */
export function workspaceStartBlockedReason(input: WorkspaceStartInput): string | null {
  const workspace = workspaceBlockedReason(input)
  if (workspace) return workspace
  if ((input.activeRunId ?? '').trim().length > 0) return workspaceBusyMessage()
  return null
}

/** Reason this runtime cannot take a new run, or `null` when it can. */
export function runtimeStartBlockedReason(input: RuntimeStartInput): string | null {
  if (!input.runtimeValid) return missingRuntimeMessage()
  if (!input.runtimeInstalled) return missingRuntimeBinaryMessage(input.runtimeBin ?? '')
  return null
}

/**
 * Reason starting a chat would refuse, in the server's own order, or `null`
 * when the composer may send.
 */
export function startChatBlockedReason(input: StartChatGateInput): string | null {
  return (
    workspaceStartBlockedReason(input) ??
    runtimeStartBlockedReason(input) ??
    (input.promptValid ? null : emptyChatPromptMessage())
  )
}

/** True when a new run may start. */
export function canStartChat(input: StartChatGateInput): boolean {
  return startChatBlockedReason(input) === null
}
