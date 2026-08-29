/**
 * Extra gates that only apply to a run nobody is watching.
 *
 * A scheduled or webhook-triggered run has no human to notice that it landed
 * in the wrong checkout, inherited the previous run's half-finished edits, or
 * spent four minutes discovering that `gh` is logged out. These three rules
 * are what separate an AFK-safe automation from one that merely started on
 * time:
 *
 * 1. **Isolation** — unattended coding happens in an app-managed worktree on
 *    its own branch, never in the checkout the user's editor is sitting in.
 *    Sharing that checkout is what lets one automation's branch switch and
 *    broken build leak into every later automation.
 * 2. **Health** — the worktree must physically exist, be the right worktree,
 *    be on its configured branch, and be clean (see `workspaceHealth.ts`).
 * 3. **Capability preflight** — an automation that is going to reach for
 *    GitHub is refused up front when `gh` is missing or logged out, instead of
 *    crashing partway through and leaving the workspace half-edited.
 *
 * Pure and browser-safe so Enable, the scheduler, the queue drain and the
 * automation UI all refuse for the same reason in the same words.
 */
import { ghNotAuthenticatedMessage, ghNotInstalledMessage } from './gitActionGate.ts'
import { workspaceHealthBlockedReason, type WorkspaceHealth } from './workspaceHealth.ts'

export type UnattendedGateInput = {
  /** 'main' is the user's own checkout; 'worktree' is app-managed and disposable. */
  workspaceKind: string
  /** Task opt-out. False lets an automation deliberately run in the main checkout. */
  requireIsolation: boolean
  /** Physical state of the workspace; null when it could not be inspected. */
  health: WorkspaceHealth | null
  /** True when this automation may open PRs or was marked as needing the gh CLI. */
  requiresGh: boolean
  ghInstalled: boolean
  ghAuthenticated: boolean
}

/** Developer-facing error when an unattended run targets the shared checkout. */
export function sharedCheckoutMessage(): string {
  return "Unattended runs are not allowed in the main checkout — it is shared with your editor and with every other automation, so one run's branch switch and leftover edits become the next run's starting point. Give this automation its own worktree, or turn off workspace isolation for it."
}

/** Developer-facing error when gh is required but not usable right now. */
export function ghPreflightMessage(installed: boolean): string {
  return installed ? ghNotAuthenticatedMessage() : ghNotInstalledMessage()
}

/** Developer-facing error when a managed worktree already has an AFK owner. */
export function workspaceOwnerMessage(ownerName: string): string {
  const owner = ownerName.trim() || 'another automation'
  return `This worktree is already assigned to unattended automation "${owner}". Give this automation its own worktree before enabling or firing it.`
}

/**
 * True when this automation is going to touch GitHub — either because its
 * runtime is allowed to open PRs (the prompt appendix tells it to run
 * `gh pr create`) or because the automation was explicitly marked as needing
 * an authenticated CLI.
 */
export function requiresGhAuth(input: { canOpenPrs: boolean; requireGhAuth: boolean }): boolean {
  return input.canOpenPrs || input.requireGhAuth
}

/**
 * Reason an unattended fire would be unsafe, or `null` when it may proceed.
 * Isolation first: a shared checkout makes every other signal untrustworthy.
 */
export function unattendedBlockedReason(input: UnattendedGateInput): string | null {
  if (input.requireIsolation && input.workspaceKind === 'main') {
    return sharedCheckoutMessage()
  }
  const health = workspaceHealthBlockedReason(input.health, { unattended: true })
  if (health) return health
  if (input.requiresGh && !(input.ghInstalled && input.ghAuthenticated)) {
    return ghPreflightMessage(input.ghInstalled)
  }
  return null
}

/** True when an unattended fire may proceed. */
export function canRunUnattended(input: UnattendedGateInput): boolean {
  return unattendedBlockedReason(input) === null
}
