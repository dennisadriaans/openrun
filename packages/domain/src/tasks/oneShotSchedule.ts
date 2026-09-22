/** One-offs missed by at most this much are caught up when Open Run wakes. */
export const ONE_SHOT_GRACE_MS = 15 * 60_000

export type OneShotDecision =
  | { kind: 'wait'; delayMs: number }
  | { kind: 'fire' }
  | { kind: 'miss'; lateByMs: number }
  | { kind: 'invalid' }

export function oneShotDecision(
  scheduledAt: number,
  now = Date.now(),
  graceMs = ONE_SHOT_GRACE_MS,
): OneShotDecision {
  if (!Number.isFinite(scheduledAt) || scheduledAt <= 0) return { kind: 'invalid' }
  const delayMs = scheduledAt - now
  if (delayMs > 0) return { kind: 'wait', delayMs }
  const lateByMs = Math.abs(delayMs)
  return lateByMs <= graceMs ? { kind: 'fire' } : { kind: 'miss', lateByMs }
}
