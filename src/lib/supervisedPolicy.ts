/**
 * Policy for Supervised (`approval-required`) runs.
 *
 * Supervised mode pauses on a risky tool call and waits for a human decision
 * (see `claudeControl.ts`). That only makes sense when someone is watching:
 * a scheduled/cron run is unattended by definition, so a supervised child that
 * blocks on an approval would hold a process and a run row with no audience.
 *
 * Kept in `lib/` (no Node imports) so both the server executor and any client
 * form can share the same rule.
 */
import { isAcpTransport } from './acpTransport.ts'
import type { RuntimeMode } from './runtimeMode'

export const SUPERVISED_MODE: RuntimeMode = 'approval-required'

/**
 * How long an unanswered approval request waits before it is auto-denied and
 * the reason is written to the run log. Prevents a supervised child from
 * hanging forever when no one answers.
 */
export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

export function isSupervised(mode: RuntimeMode | string | null | undefined): boolean {
  return mode === SUPERVISED_MODE
}

/**
 * Can this runtime actually pause and ask?
 *
 * Two transports can: Claude's CLI, which asks over its stdio control protocol
 * (`--permission-prompt-tool stdio`), and any ACP agent, where
 * `session/request_permission` is part of the protocol. `codex exec` and
 * `grok --output-format streaming-json` are non-interactive — they decide from
 * their own flags and never ask us — so offering Supervised for them would be a
 * button that silently does nothing.
 *
 * The composer's mode picker and the server's refuse path both call this, so a
 * mode the UI hides is also a mode the server rejects.
 */
export function supportsSupervised(input: {
  bin: string | null | undefined
  transport?: string | null
}): boolean {
  if (isAcpTransport(input.transport)) return true
  return Boolean(input.bin?.includes('claude'))
}

/**
 * Throw when a run asks for Supervised on a runtime that cannot ask for
 * permission. Mirrors the picker so the two cannot drift.
 */
export function assertSupervisedSupported(input: {
  bin: string | null | undefined
  transport?: string | null
  mode: RuntimeMode | string | null | undefined
}): void {
  if (!isSupervised(input.mode)) return
  if (supportsSupervised(input)) return
  throw new Error(
    'This runtime cannot pause for approvals: only Claude Code and runtimes on the Agent Client Protocol transport can ask before using a tool. Use Full access or Auto-accept edits.',
  )
}

/** Triggers that have a human in the loop and may therefore use Supervised. */
export function supervisedAllowedForTrigger(trigger: string): boolean {
  // schedule (cron) and webhook are unattended. manual / planner / chat are
  // initiated by a present user.
  return trigger !== 'schedule' && trigger !== 'webhook'
}

/**
 * Throw when a run would be Supervised on a trigger with nobody watching.
 * The executor calls this before spawning so an unattended supervised run
 * fails fast with a clear reason instead of hanging on an approval prompt.
 */
export function assertSupervisedAllowed(
  trigger: string,
  mode: RuntimeMode | string | null | undefined,
): void {
  if (isSupervised(mode) && !supervisedAllowedForTrigger(trigger)) {
    throw new Error(
      'Supervised runs need someone to answer approval prompts, so they cannot run on a schedule or webhook. Use Full access or Auto-accept edits for unattended automations.',
    )
  }
}
