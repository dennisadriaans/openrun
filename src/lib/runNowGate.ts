/**
 * Whether Run now is safe in the Automations UI — mirrors runTaskNow /
 * startRun refuse gates so the Play control can disable instead of alert().
 * Cron validity is intentionally omitted: schedules are for Enable; manual
 * runs do not require a valid cron expression.
 */
import { runPrereqBlockedReason, type RunPrereqInput } from './runPrereqGate.ts'

/** Fields the list/detail pages already have on TaskWithMeta. */
export type RunNowGateInput = RunPrereqInput

/**
 * Developer-facing reason Run now would fail, in the same order as
 * `runTaskNow` → `startRun` on the server. `null` means the run may start.
 */
export function runNowBlockedReason(input: RunNowGateInput): string | null {
  return runPrereqBlockedReason(input)
}

/** True when Run now may proceed. */
export function canRunTaskNow(input: RunNowGateInput): boolean {
  return runNowBlockedReason(input) === null
}
