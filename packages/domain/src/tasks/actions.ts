/**
 * "Why is this button disabled" — as data, so a client need not own the rule.
 *
 * The gate modules (`runNowGate`, `enableGate`, `gitActionGate`, …) are the
 * single implementation of every refuse condition, and a TypeScript client
 * imports them directly. A Swift client cannot, and re-implementing them in
 * another language is how the fifth refuse condition ends up in three places
 * and missing from the fourth.
 *
 * So this module runs those same gates once and turns their answers into a
 * small serialisable map that rides along with the resource it describes:
 *
 * ```json
 * "actions": {
 *   "runNow": { "enabled": false, "reason": "Workspace has uncommitted changes." },
 *   "enable": { "enabled": true }
 * }
 * ```
 *
 * The rule still lives in exactly one place. What changes is that its *output*
 * is now reachable from a client that cannot run TypeScript. Clients that can
 * are unaffected — they may keep calling the gates locally for an instant
 * optimistic disable, and the two cannot disagree because they are the same
 * function.
 *
 * Pure and browser-safe: no `node:` imports, no database. Same contract as
 * every other module in `src/lib/`.
 */
import { enableBlockedReason, type EnableGateInput } from './enableGate.ts'
import { runNowBlockedReason, type RunNowGateInput } from './runNowGate.ts'

/** One control's state, and the words to show when it is off. */
export type ActionDecision = {
  enabled: boolean
  /**
   * Why not, when `enabled` is false. Absent when enabled — a reason on an
   * available control would be shown by a naive client.
   */
  reason?: string
}

/** Every decision attached to one resource, keyed by the control's name. */
export type ActionMap = Readonly<Record<string, ActionDecision>>

/** Turn a gate's `string | null` answer into a decision. */
export function decide(blockedReason: string | null | undefined): ActionDecision {
  return blockedReason ? { enabled: false, reason: blockedReason } : { enabled: true }
}

/**
 * What a client needs to render an automation's controls.
 *
 * Structurally a subset of `TaskWithMeta`, so the server passes the row it
 * already built and nothing has to be gathered twice.
 */
export type TaskActionInput = RunNowGateInput & EnableGateInput

export type TaskActions = {
  /** Trigger a run immediately. Cron validity deliberately not required. */
  runNow: ActionDecision
  /**
   * Arm the schedule. Stricter than Run now: arming promises the automation is
   * safe to run unattended, so the AFK rules apply here and not there.
   */
  enable: ActionDecision
}

export function taskActions(input: TaskActionInput): TaskActions {
  return {
    runNow: decide(runNowBlockedReason(input)),
    enable: decide(enableBlockedReason(input)),
  }
}

/**
 * True when every named control is available.
 *
 * Handy for a client that wants one "is anything wrong here" flag without
 * inspecting each decision.
 */
export function allEnabled(actions: ActionMap): boolean {
  return Object.values(actions).every((decision) => decision.enabled)
}

/**
 * The first reason anything is blocked, or `null`.
 *
 * Order follows the key order of the map, which the server builds in the order
 * the server itself would refuse.
 */
export function firstBlockedReason(actions: ActionMap): string | null {
  for (const decision of Object.values(actions)) {
    if (!decision.enabled && decision.reason) return decision.reason
  }
  return null
}
