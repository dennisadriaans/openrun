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
  /**
   * Why an unattended fire would refuse — shared checkout, contaminated
   * worktree, unusable gh. Computed on the server (it needs the filesystem and
   * git) and carried on TaskWithMeta; omitted by callers that predate it.
   */
  unattendedBlockedReason?: string | null
}

/**
 * Developer-facing reason Enable would fail, in the same order as
 * `setTaskEnabled` on the server. `null` means arming is allowed.
 *
 * Arming is a promise that this automation is safe to run while nobody is
 * watching, so the AFK rules gate Enable even though they do not gate Run now.
 */
export function enableBlockedReason(input: EnableGateInput): string | null {
  if (!input.cronValid) return invalidCronMessage(input.cron)
  const prereq = runPrereqBlockedReason(input)
  if (prereq) return prereq
  return input.unattendedBlockedReason ?? null
}

/** True when Enable may proceed (Pause is always allowed separately). */
export function canEnableTask(input: EnableGateInput): boolean {
  return enableBlockedReason(input) === null
}
