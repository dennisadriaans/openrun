/**
 * Why "Create automation" on a freshly connected integration is disabled.
 *
 * A connection that no automation binds receives every delivery and matches
 * nothing, so the setup panel is the step that turns Connect into something
 * that runs — and it must refuse for the same reasons the server does, in the
 * same order and with the same words. The server path is
 * `createIntegrationAutomation` → `upsertTask`; this mirrors it so the button
 * disables and explains instead of throwing after the click.
 *
 * Browser-safe and dependency-free, like every gate module.
 */
import { missingProjectChecksMessage } from '../checks.ts'
import { missingRuntimeBinaryMessage } from '../runtimeBinary.ts'
import { emptyTaskPromptMessage, hasTaskPrompt } from '../taskPrompt.ts'
import { isWorkspaceReady, workspaceNotReadyMessage } from '../workspaceReady.ts'

/** Thrown by `createIntegrationAutomation` when no workspace was chosen. */
export const PICK_WORKSPACE_MESSAGE = 'Choose a project for the automation.'

/** Thrown by `createIntegrationAutomation` when no runtime was chosen. */
export const PICK_RUNTIME_MESSAGE = 'Pick a runtime for the automation.'

export type IntegrationSetupGateInput = {
  workspaceId: string
  /** Lifecycle status of the chosen workspace; absent means it did not resolve. */
  workspaceStatus?: string | null
  /** `main` is the checkout the user's editor has open. */
  workspaceKind?: string | null
  runtimeId: string
  /** Whether the runtime's binary resolves on PATH — the automation is armed. */
  runtimeInstalled: boolean
  runtimeBin?: string
  prompt: string
  /**
   * Verification checks configured on the automation's project. A webhook
   * automation is unattended by definition, and `upsertTask` refuses to arm
   * one without a definition of done.
   */
  projectCheckCount: number
}

/**
 * Reason the setup panel would refuse, or `null` when it may create. Order
 * matches the server: workspace id → ready → isolation → runtime → PATH →
 * prompt → verification.
 */
export function integrationSetupBlockedReason(input: IntegrationSetupGateInput): string | null {
  if (!input.workspaceId.trim()) return PICK_WORKSPACE_MESSAGE
  if (!isWorkspaceReady(input.workspaceStatus)) {
    return workspaceNotReadyMessage(input.workspaceStatus)
  }
  // Unattended by definition: a webhook fire into the checkout the editor has
  // open is the one outcome nobody asks for, and `upsertTask` refuses it.
  if (!input.runtimeId.trim()) return PICK_RUNTIME_MESSAGE
  if (!input.runtimeInstalled) return missingRuntimeBinaryMessage(input.runtimeBin ?? '')
  if (!hasTaskPrompt(input.prompt)) return emptyTaskPromptMessage()
  if (input.projectCheckCount <= 0) return missingProjectChecksMessage()
  return null
}

export function canCreateIntegrationAutomation(input: IntegrationSetupGateInput): boolean {
  return integrationSetupBlockedReason(input) === null
}
