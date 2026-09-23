/**
 * Wall-clock budgets for the long-running commands Open Run shells out to on a
 * request, and the words used when one runs out.
 *
 * These four — cloning a repo, preparing a worktree, pushing a branch, opening
 * a pull request — used to run through `spawnSync` with no timeout at all. That
 * is worse than it sounds in a single-process server: a synchronous child
 * blocks the whole event loop, so a `pnpm install` in a fresh worktree froze
 * every other request, stopped the SSE heartbeats (which is what the live
 * streams use to decide they are alive), and a command that hung waiting on
 * stdin froze the app until it was killed by hand.
 *
 * The budgets differ because the work differs: a cold clone of a large repo is
 * legitimately slow, while `gh pr create` is two API calls and has no business
 * taking a minute.
 *
 * Pure and browser-safe so the server and its tests agree on one set of limits
 * and one set of messages.
 */

/** A cold clone of a large repository over a slow link. */
export const CLONE_TIMEOUT_MS = 10 * 60_000

/** `pnpm install` and friends in a fresh worktree. */
export const SETUP_TIMEOUT_MS = 15 * 60_000

/** Pushing a branch, including the first push of a large history. */
export const PUSH_TIMEOUT_MS = 5 * 60_000

/** `gh pr create` — a couple of API round trips. */
export const PR_CREATE_TIMEOUT_MS = 60_000

function minutes(ms: number): string {
  const value = ms / 60_000
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${rounded} minute${value === 1 ? '' : 's'}`
}

/**
 * What the user is told when a command outran its budget.
 *
 * Names the budget and what to do next, because "it timed out" on its own
 * leaves someone staring at a spinner that has already stopped.
 */
export function commandTimedOutMessage(label: string, timeoutMs: number): string {
  return `${label} did not finish within ${minutes(timeoutMs)} and was stopped. Run it yourself in the workspace to see where it gets stuck, then try again.`
}

/** What the user is told when a command produced more output than we will hold. */
export function commandOutputTooLargeMessage(label: string): string {
  return `${label} produced more output than Open Run will hold and was stopped. Quieten the command (or redirect its output) and try again.`
}
