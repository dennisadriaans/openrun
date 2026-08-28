/**
 * Wall-clock budget for a single agent turn.
 *
 * Without one, a wedged CLI holds a `running` run row and the workspace lock
 * forever: every later scheduled fire for that workspace is refused, and the
 * only way out is restarting the app. The budget is per task (0 = the app
 * default) and enforced in the executor, which SIGTERMs then SIGKILLs.
 *
 * Node-free so the automation form and the executor agree on the same bounds.
 */

export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000
export const MIN_RUN_TIMEOUT_MS = 60 * 1000
export const MAX_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000

/** Grace period between SIGTERM and SIGKILL, matching cancelRun. */
export const RUN_KILL_GRACE_MS = 4_000

/** Resolve a stored per-task budget (0 / unset = app default). */
export function resolveRunTimeoutMs(taskTimeoutMs: number | null | undefined): number {
  if (!Number.isFinite(taskTimeoutMs ?? NaN)) return DEFAULT_RUN_TIMEOUT_MS
  const ms = Math.floor(taskTimeoutMs as number)
  if (ms <= 0) return DEFAULT_RUN_TIMEOUT_MS
  return Math.min(Math.max(ms, MIN_RUN_TIMEOUT_MS), MAX_RUN_TIMEOUT_MS)
}

export function runTimeoutOutOfRangeMessage(): string {
  return `A run timeout must be between ${MIN_RUN_TIMEOUT_MS / 60_000} and ${MAX_RUN_TIMEOUT_MS / 60_000 / 60} hours' worth of minutes — leave it empty for the ${DEFAULT_RUN_TIMEOUT_MS / 60_000}-minute default.`
}

/** Strict write path for the automation form: minutes in, milliseconds out. */
export function assertRunTimeoutMinutes(minutes: number | null | undefined): number {
  if (minutes == null || !Number.isFinite(minutes) || minutes === 0) return 0
  const ms = Math.floor(minutes * 60_000)
  if (ms < MIN_RUN_TIMEOUT_MS || ms > MAX_RUN_TIMEOUT_MS) {
    throw new Error(runTimeoutOutOfRangeMessage())
  }
  return ms
}

export function runTimedOutMessage(timeoutMs: number): string {
  const minutes = Math.round(timeoutMs / 60_000)
  return `Run stopped after its ${minutes}-minute budget elapsed.`
}

/**
 * Silence watchdog. A CLI waiting out a usage limit produces no output at all,
 * which is indistinguishable from a long tool call until you know how long the
 * quiet has lasted — so say so in the log rather than killing the turn.
 */
export const RUN_STALL_AFTER_MS = 5 * 60 * 1000
export const RUN_STALL_CHECK_MS = 30 * 1000

export function runStalledMessage(silentMs: number): string {
  const minutes = Math.max(1, Math.round(silentMs / 60_000))
  return `No output from the agent for ${minutes} minutes — it may be wedged or waiting out a usage limit.`
}

/** How long a CLI may linger after it said the turn was done. */
export const TURN_DONE_LINGER_MS = 15 * 1000
