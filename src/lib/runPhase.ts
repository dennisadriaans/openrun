/**
 * What a run is doing once the agent's turn has finished but the run is still
 * open — i.e. the verification pass.
 *
 * The agent narrates itself through turn events; checks do not, so without
 * this the tail of a run reads as a bare "Working…" that looks like the agent
 * is still typing when it is really waiting on `pnpm test`. Pure so chat and
 * the mobile API cannot disagree about the wording.
 */
import type { CachedCheckResult } from './applyRunLiveEvent'
import { latestPass } from './checkPass'

function clamp(text: string, max = 60): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export type VerificationPhase = {
  /** Verb for the working indicator, e.g. `Running check lint`. */
  label: string
  /** Command behind the running check; empty while no check is in flight. */
  command: string
  /** Start of the running check, for the elapsed timer. */
  startedAt?: number
}

/**
 * Describe the post-turn phase of a still-running run.
 *
 * Only the number of checks already announced is knowable here, so the label
 * names the check instead of counting towards a total the client cannot see.
 */
export function verificationPhase(results: CachedCheckResult[]): VerificationPhase {
  const active = latestPass(results).find((r) => r.outcome === 'running')
  if (!active) return { label: 'Finishing turn', command: '' }

  return {
    label: `Running check ${clamp(active.name, 40)}`,
    command: clamp(active.command),
    startedAt: active.startedAt,
  }
}
