/**
 * Whether Commit / Discard / Push / Create PR are safe in the run workspace UI
 * — mirrors the UI refuse conditions (and Push/PR server gates) so the
 * controls can disable with a hover reason instead of opening a dialog (or
 * calling git/gh) that then fails.
 *
 * Pure and browser-safe: Push/PR messages are shared with `git.push` /
 * `git.createPullRequest` so the UI title matches the thrown error. Clean-tree
 * Commit/Discard messages match the sidebar "Working tree clean" copy.
 */

export type PushGateInput = {
  /** True when the workspace has an `origin` remote URL. */
  hasRemote: boolean
}

export type PrGateInput = {
  hasRemote: boolean
  ghInstalled: boolean
  ghAuthenticated: boolean
}

/** Combined ship-gate fields for Push + Create PR controls. */
export type ShipGateInput = PrGateInput

/** True when the run's Files Changed list is non-empty. */
export type DirtyTreeGateInput = {
  hasChanges: boolean
}

/** Build ship-gate input from repo + gh status (shared by sidebar and menu). */
export function shipGateFrom(input: {
  hasRemote: boolean
  ghInstalled: boolean
  ghAuthenticated: boolean
}): ShipGateInput {
  return {
    hasRemote: input.hasRemote,
    ghInstalled: input.ghInstalled,
    ghAuthenticated: input.ghAuthenticated,
  }
}

/** Developer-facing error when the workspace has no origin remote. */
export function missingOriginRemoteMessage(): string {
  return 'No origin remote — push and pull requests are unavailable.'
}

/** Developer-facing error when the gh CLI binary is missing. */
export function ghNotInstalledMessage(): string {
  return 'Install the gh CLI to open pull requests.'
}

/** Developer-facing error when gh is present but not logged in. */
export function ghNotAuthenticatedMessage(): string {
  return 'Run gh auth login to enable pull requests.'
}

/** Hover copy when Commit / Discard are disabled because the tree is clean. */
export function workingTreeCleanMessage(): string {
  return 'Working tree clean — nothing to commit or discard.'
}

/**
 * Reason Commit is unavailable, or `null` when the dialog may open.
 * Mirrors the `!hasChanges` disable on the Commit control.
 */
export function commitBlockedReason(input: DirtyTreeGateInput): string | null {
  if (!input.hasChanges) return workingTreeCleanMessage()
  return null
}

/** True when Commit may proceed. */
export function canCommit(input: DirtyTreeGateInput): boolean {
  return commitBlockedReason(input) === null
}

/**
 * Reason Discard is unavailable, or `null` when the confirm dialog may open.
 * Mirrors the `!hasChanges` disable on the Discard control.
 */
export function discardBlockedReason(input: DirtyTreeGateInput): string | null {
  if (!input.hasChanges) return workingTreeCleanMessage()
  return null
}

/** True when Discard may proceed. */
export function canDiscard(input: DirtyTreeGateInput): boolean {
  return discardBlockedReason(input) === null
}

/**
 * Reason Push would fail, or `null` when push may proceed.
 * Order matches `git.push` on the server (remote check first).
 */
export function pushBlockedReason(input: PushGateInput): string | null {
  if (!input.hasRemote) return missingOriginRemoteMessage()
  return null
}

/** True when Push may proceed (caller still gates on in-flight pending). */
export function canPush(input: PushGateInput): boolean {
  return pushBlockedReason(input) === null
}

/**
 * Reason Create PR would fail, or `null` when the dialog may open.
 * Order: remote → gh installed → gh authenticated — same as
 * `git.createPullRequest` after this change.
 */
export function prBlockedReason(input: PrGateInput): string | null {
  if (!input.hasRemote) return missingOriginRemoteMessage()
  if (!input.ghInstalled) return ghNotInstalledMessage()
  if (!input.ghAuthenticated) return ghNotAuthenticatedMessage()
  return null
}

/** True when Create PR may proceed. */
export function canCreatePullRequest(input: PrGateInput): boolean {
  return prBlockedReason(input) === null
}

/** Hover copy when Ship is disabled because there is nothing to carry. */
export function nothingToShipMessage(): string {
  return 'Nothing to ship — no uncommitted changes and no unpushed commits.'
}

/**
 * One-click ship: group the dirty tree into conventional commits, push, and
 * open the PR. It needs everything Push and Create PR need, plus something to
 * carry — either uncommitted changes or commits the remote has not seen.
 */
export type ShipGateState = ShipGateInput & {
  hasChanges: boolean
  /** Commits on the branch that origin does not have yet. */
  ahead: number
}

/** Reason Ship would fail, or `null` when it may proceed. */
export function shipBlockedReason(input: ShipGateState): string | null {
  const pr = prBlockedReason(input)
  if (pr) return pr
  if (!input.hasChanges && input.ahead <= 0) return nothingToShipMessage()
  return null
}

/** True when Ship may proceed (caller still gates on in-flight pending). */
export function canShip(input: ShipGateState): boolean {
  return shipBlockedReason(input) === null
}
