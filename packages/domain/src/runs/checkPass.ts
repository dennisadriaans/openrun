/**
 * Which check results are "the current state of this run".
 *
 * A verification pass is keyed by the turn it verified *and* the repair attempt
 * it belongs to. Grouping on `attempt` alone is not enough: every non-repair
 * turn records `attempt = 0`, so two ordinary turns of the same run would fold
 * into one pass and report the same failure twice.
 *
 * Browser-safe and dependency-free on purpose — the run panel and the server's
 * `latestCheckResults` must agree on what the latest pass is.
 */

export type CheckPassRow = {
  messageId: string
  attempt: number
  outcome: string
  startedAt: number
}

/** Rows of the newest pass only — one turn, one attempt. */
export function latestPass<T extends CheckPassRow>(results: readonly T[]): T[] {
  if (results.length === 0) return []
  let newest = results[0]
  for (const row of results) {
    if (row.attempt > newest.attempt) newest = row
    else if (row.attempt === newest.attempt && row.startedAt >= newest.startedAt) newest = row
  }
  // Rows written before `messageId` existed carry '' — fall back to the old
  // attempt-only grouping rather than lumping every legacy pass together.
  if (!newest.messageId) return results.filter((r) => r.attempt === newest.attempt)
  return results.filter((r) => r.attempt === newest.attempt && r.messageId === newest.messageId)
}

export function isFailingOutcome(outcome: string): boolean {
  return outcome === 'failed' || outcome === 'timeout'
}

/** Failing checks in the newest pass. Takes the full result list. */
export function countFailingChecks(results: readonly CheckPassRow[]): number {
  return latestPass(results).filter((r) => isFailingOutcome(r.outcome)).length
}

/**
 * True when the newest pass verified an earlier turn than the one the run is
 * now on — the panel is showing a judgement about code that has since moved.
 */
export function isPassStale(results: readonly CheckPassRow[], currentMessageId: string): boolean {
  const pass = latestPass(results)
  const messageId = pass[0]?.messageId ?? ''
  if (!messageId || !currentMessageId) return false
  return messageId !== currentMessageId
}
