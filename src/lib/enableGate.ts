/**
 * Whether Enable is safe in the Automations UI — mirrors setTaskEnabled's
 * refuse-to-arm gates so the Power control can disable instead of alert().
 * Pause always stays available (disarming never needs these checks).
 */
import { invalidCronMessage } from './cron.ts'
import { runPrereqBlockedReason, type RunPrereqInput } from './runPrereqGate.ts'

/** Fields the list/detail pages already have on TaskWithMeta. */
export type EnableGateInput = RunPrereqInput & {
  cron: string
  cronValid: boolean
}

/**
 * Developer-facing reason Enable would fail, in the same order as
 * `setTaskEnabled` on the server. `null` means arming is allowed.
 */
export function enableBlockedReason(input: EnableGateInput): string | null {
  if (!input.cronValid) return invalidCronMessage(input.cron)
  return runPrereqBlockedReason(input)
}

/** True when Enable may proceed (Pause is always allowed separately). */
export function canEnableTask(input: EnableGateInput): boolean {
  return enableBlockedReason(input) === null
}
