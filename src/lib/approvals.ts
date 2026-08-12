/**
 * Tool-approval model for Supervised runs, expressed in ACP's terms.
 *
 * ACP models an approval as `session/request_permission`: the agent offers a
 * list of `PermissionOption`s and the client answers with an outcome naming the
 * option it picked. Every ACP agent speaks this, so modelling our approvals the
 * same way is what lets one chat UI supervise any agent instead of only Claude.
 *
 * The transports differ underneath — Claude's JSONL `control_request` takes a
 * boolean-ish allow/deny envelope on stdin, ACP takes a JSON-RPC response — so
 * this module also owns the mapping from an option back to that allow/deny
 * decision. See `lib/claudeControl.ts` and `server/acpTurn.ts` for the two
 * responders.
 *
 * Browser-safe and dependency-free: the chat UI renders buttons straight from
 * these options, and the executor validates decisions against the same list.
 */
import type { PermissionOption, PermissionOutcome } from './acp.ts'

export type ApprovalDecision = 'allow' | 'deny'

/** Option ids we generate ourselves when an agent supplies no list. */
export const ALLOW_ONCE = 'allow-once'
export const ALLOW_ALWAYS = 'allow-always'
export const REJECT_ONCE = 'reject-once'

/**
 * The options a JSONL CLI's approval prompt gets.
 *
 * Claude's control protocol has no "always" concept — the decision applies to
 * the one call it asked about — so we deliberately offer only once-scoped
 * options rather than a button that would quietly not stick.
 */
export function permissionOptionsForTool(toolName?: string): PermissionOption[] {
  const what = toolName?.trim() ? ` ${toolName.trim()}` : ''
  return [
    { optionId: ALLOW_ONCE, name: `Allow${what}`, kind: 'allow_once' },
    { optionId: REJECT_ONCE, name: 'Deny', kind: 'reject_once' },
  ]
}

/** Does picking this option mean yes? Falls back to the id for our own ids. */
export function decisionForOption(
  option: PermissionOption | undefined,
  optionId: string,
): ApprovalDecision {
  if (option) return option.kind.startsWith('allow') ? 'allow' : 'deny'
  return optionId === ALLOW_ONCE || optionId === ALLOW_ALWAYS ? 'allow' : 'deny'
}

/**
 * Resolve an answer to an approval prompt.
 *
 * Accepts either an `optionId` (the ACP way, and what the UI sends once the
 * agent offers real options) or a bare allow/deny decision (what the chat sent
 * before options existed, and what auto-deny-on-timeout produces). Returns both
 * representations so callers can persist the option and act on the decision.
 */
export function resolveApprovalAnswer(input: {
  options?: PermissionOption[]
  optionId?: string
  decision?: ApprovalDecision
}): { optionId: string; decision: ApprovalDecision } {
  const options = input.options ?? []

  if (input.optionId) {
    const match = options.find((o) => o.optionId === input.optionId)
    return {
      optionId: input.optionId,
      decision: decisionForOption(match, input.optionId),
    }
  }

  const decision: ApprovalDecision = input.decision ?? 'deny'
  const wanted = decision === 'allow' ? 'allow' : 'reject'
  // Prefer a once-scoped option so a plain "allow" never silently grants
  // standing permission when the agent offered an allow_always button too.
  const match =
    options.find((o) => o.kind === `${wanted}_once`) ??
    options.find((o) => o.kind.startsWith(wanted))
  return {
    optionId: match?.optionId ?? (decision === 'allow' ? ALLOW_ONCE : REJECT_ONCE),
    decision,
  }
}

/** The ACP response body for an answered prompt. */
export function permissionOutcome(optionId: string): PermissionOutcome {
  return { outcome: 'selected', optionId }
}

/** The ACP response body when the run ends before anyone answers. */
export function cancelledOutcome(): PermissionOutcome {
  return { outcome: 'cancelled' }
}
