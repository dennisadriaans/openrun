/**
 * Pull request state for a run, shared by the server probe and the UI chip.
 *
 * A run can end up attached to a PR two ways: the user pressed "Open pull
 * request" in the workspace panel, or the agent shelled out to `gh pr create`
 * itself (see lib/prCapability.ts). Both land on the run's branch, so the
 * branch — not our own bookkeeping — is the source of truth, and this module
 * only shapes what `gh pr view --json` hands back.
 *
 * Pure and browser-safe.
 */

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

/** Rollup of the PR's CI checks; `none` when GitHub reports no checks at all. */
export type PullRequestChecks = 'passing' | 'failing' | 'pending' | 'none'

export type RunPullRequest = {
  number: number
  url: string
  title: string
  state: PullRequestState
  checks: PullRequestChecks
}

type CheckNode = {
  status?: string | null
  conclusion?: string | null
  state?: string | null
}

const FAILING_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'])
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

/** Collapse GitHub's per-check rows into one verdict, worst outcome first. */
export function rollupChecks(nodes: CheckNode[] | null | undefined): PullRequestChecks {
  if (!nodes || nodes.length === 0) return 'none'
  let pending = false
  let passing = false
  for (const node of nodes) {
    // Check runs report `conclusion`; legacy commit statuses report `state`.
    const verdict = (node.conclusion || node.state || '').toUpperCase()
    if (FAILING_CONCLUSIONS.has(verdict) || verdict === 'ERROR') return 'failing'
    if (!verdict || verdict === 'PENDING' || verdict === 'EXPECTED') pending = true
    else if (PASSING_CONCLUSIONS.has(verdict)) passing = true
  }
  if (pending) return 'pending'
  return passing ? 'passing' : 'none'
}

/** Parse `gh pr view --json ...` output. Returns null when there is no PR. */
export function parseGhPullRequest(stdout: string): RunPullRequest | null {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return null
  }
  const number = Number(raw.number ?? 0)
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (!number || !url) return null

  const ghState = String(raw.state ?? '').toUpperCase()
  const state: PullRequestState =
    ghState === 'MERGED'
      ? 'merged'
      : ghState === 'CLOSED'
        ? 'closed'
        : raw.isDraft === true
          ? 'draft'
          : 'open'

  return {
    number,
    url,
    title: typeof raw.title === 'string' ? raw.title : '',
    state,
    checks: rollupChecks(raw.statusCheckRollup as CheckNode[] | null),
  }
}

/**
 * Whether the PR still wants the user's eye — this is what lights the dot, so
 * it goes dark the moment the PR merges or closes.
 */
export function isPullRequestLive(state: PullRequestState): boolean {
  return state === 'open' || state === 'draft'
}

const STATE_LABEL: Record<PullRequestState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
}

export function pullRequestStateLabel(state: PullRequestState): string {
  return STATE_LABEL[state]
}
