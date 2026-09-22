/**
 * sessionStorage helpers for dismissing planner proposals on a given run.
 * Browser-only; no-ops safely when storage is unavailable.
 */

const PREFIX = 'agentops:planner-dismissed:'

function key(runId: string): string {
  return `${PREFIX}${runId}`
}

export function loadDismissedProposals(runId: string): Set<string> {
  if (!runId || typeof sessionStorage === 'undefined') return new Set()
  try {
    const raw = sessionStorage.getItem(key(runId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

export function persistDismissedProposals(runId: string, fingerprints: Set<string>): void {
  if (!runId || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(key(runId), JSON.stringify([...fingerprints]))
  } catch {
    // Quota / private mode — dismissals stay in-memory only.
  }
}
