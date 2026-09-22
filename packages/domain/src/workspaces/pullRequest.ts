/**
 * Pull request state for a run, shared by the server probe and the UI chip.
 *
 * A run can end up attached to a PR two ways: the user pressed "Open pull
 * request" in the workspace panel, or the agent shelled out to `gh pr create`
 * itself (see lib/prCapability.ts). Both land on the run's branch, so the
 * branch — not our own bookkeeping — is the source of truth, and this module
 * only shapes what the `gh pr list` JSON response hands back.
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
  /**
   * The checks that are red, when `checks` is `failing`. Empty otherwise, and
   * empty on a row cached before this existed — readers must tolerate that
   * rather than assume a backfill.
   */
  failingChecks: FailingCheck[]
}

type CheckNode = {
  status?: string | null
  conclusion?: string | null
  state?: string | null
  /** Check-run name; legacy commit statuses use `context` instead. */
  name?: string | null
  context?: string | null
  /** Present on a check run that belongs to a workflow. */
  workflowName?: string | null
  detailsUrl?: string | null
  targetUrl?: string | null
}

/** One red check on a pull request, named well enough to go in a prompt. */
export type FailingCheck = {
  name: string
  /** Where a human (or `gh`) can read the log. Empty when gh gave us none. */
  url: string
}

export type GhPullRequestParseResult =
  | { kind: 'found'; pullRequest: RunPullRequest }
  | { kind: 'invalid'; reason: string }

export type GhPullRequestListParseResult =
  | { kind: 'found'; pullRequest: RunPullRequest }
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }

const FAILING_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STALE',
])
const PASSING_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])
const PENDING_STATUSES = new Set([
  'EXPECTED',
  'PENDING',
  'QUEUED',
  'IN_PROGRESS',
  'REQUESTED',
  'WAITING',
])
const CHECK_STATUSES = new Set([...PENDING_STATUSES, 'COMPLETED', 'SUCCESS'])
const CHECK_STATES = new Set(['ERROR', 'EXPECTED', 'FAILURE', 'PENDING', 'SUCCESS'])
const CHECK_CONCLUSIONS = new Set([...FAILING_CONCLUSIONS, ...PASSING_CONCLUSIONS])

/** Collapse GitHub's per-check rows into one verdict, worst outcome first. */
export function rollupChecks(nodes: CheckNode[] | null | undefined): PullRequestChecks {
  if (!nodes || nodes.length === 0) return 'none'
  let pending = false
  let passing = false
  for (const node of nodes) {
    // Check runs report `conclusion` (and `status` while pending); legacy
    // commit statuses report `state`.
    const verdict = (node.conclusion || node.state || node.status || '').toUpperCase()
    if (FAILING_CONCLUSIONS.has(verdict) || verdict === 'ERROR') return 'failing'
    if (!verdict || PENDING_STATUSES.has(verdict)) pending = true
    else if (PASSING_CONCLUSIONS.has(verdict)) passing = true
  }
  if (pending) return 'pending'
  return passing ? 'passing' : 'none'
}

/** A check node's display name, preferring the most specific thing gh gave us. */
function checkNodeName(node: CheckNode): string {
  const workflow = (node.workflowName ?? '').trim()
  const name = (node.name ?? node.context ?? '').trim()
  if (workflow && name) return `${workflow} / ${name}`
  return name || workflow || 'an unnamed check'
}

function checkNodeFailing(node: CheckNode): boolean {
  const verdict = (node.conclusion || node.state || node.status || '').toUpperCase()
  return FAILING_CONCLUSIONS.has(verdict) || verdict === 'ERROR'
}

/**
 * The red checks, named and linked.
 *
 * `rollupChecks` collapses everything to one word for the chip; this keeps the
 * detail, which is what a repair turn needs to know where to look.
 */
export function failingChecks(nodes: CheckNode[] | null | undefined): FailingCheck[] {
  if (!nodes) return []
  const out: FailingCheck[] = []
  for (const node of nodes) {
    if (!checkNodeFailing(node)) continue
    out.push({
      name: checkNodeName(node),
      url: (node.detailsUrl ?? node.targetUrl ?? '').trim(),
    })
  }
  return out
}

function isCheckNode(value: unknown): value is CheckNode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const node = value as Record<string, unknown>
  const fields = ['status', 'conclusion', 'state']
  const optionalStrings = ['name', 'context', 'workflowName', 'detailsUrl', 'targetUrl']
  for (const key of optionalStrings) {
    const field = node[key]
    if (field !== undefined && field !== null && typeof field !== 'string') return false
  }
  // An empty object is not a check result. Accept vendor-added fields, but
  // require at least one of the status fields we know how to roll up.
  if (!fields.some((key) => Object.hasOwn(node, key))) return false
  return fields.every((key) => {
    const field = node[key]
    return field === undefined || field === null || typeof field === 'string'
  })
}

function checkNodeError(node: CheckNode): string | null {
  const status = node.status?.toUpperCase()
  const conclusion = node.conclusion?.toUpperCase()
  const state = node.state?.toUpperCase()
  if (status && !CHECK_STATUSES.has(status)) return 'gh returned an unknown check status'
  if (conclusion && !CHECK_CONCLUSIONS.has(conclusion)) {
    return 'gh returned an unknown check conclusion'
  }
  if (state && !CHECK_STATES.has(state)) return 'gh returned an unknown check state'
  const effective = conclusion || state || status || ''
  if (!effective) return 'gh returned a check without a status'
  // A completed check must carry its conclusion. Treating it as `none` would
  // make a malformed rollup look healthy enough to display.
  if (status === 'COMPLETED' && !conclusion && !state) {
    return 'gh returned a completed check without a conclusion'
  }
  return null
}

/** Parse a successful single-object response with shape validation. */
export function parseGhPullRequestResult(stdout: string): GhPullRequestParseResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(stdout) as unknown
  } catch {
    return { kind: 'invalid', reason: 'gh returned malformed JSON' }
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return { kind: 'invalid', reason: 'gh returned a non-object pull request' }
  }
  const raw = decoded as Record<string, unknown>
  const number = raw.number
  const url = raw.url
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
    return { kind: 'invalid', reason: 'gh returned an invalid pull request number' }
  }
  if (typeof url !== 'string' || !url.trim()) {
    return { kind: 'invalid', reason: 'gh returned an invalid pull request URL' }
  }
  if (typeof raw.title !== 'string') {
    return { kind: 'invalid', reason: 'gh returned an invalid pull request title' }
  }
  if (typeof raw.state !== 'string') {
    return { kind: 'invalid', reason: 'gh returned an invalid pull request state' }
  }
  if (typeof raw.isDraft !== 'boolean') {
    return { kind: 'invalid', reason: 'gh returned an invalid draft flag' }
  }

  if (!Array.isArray(raw.statusCheckRollup) || !raw.statusCheckRollup.every(isCheckNode)) {
    return { kind: 'invalid', reason: 'gh returned an invalid status check rollup' }
  }
  for (const node of raw.statusCheckRollup) {
    const reason = checkNodeError(node)
    if (reason) return { kind: 'invalid', reason }
  }
  const checks = rollupChecks(raw.statusCheckRollup)
  const failing = failingChecks(raw.statusCheckRollup)

  const ghState = raw.state.toUpperCase()
  if (ghState !== 'OPEN' && ghState !== 'CLOSED' && ghState !== 'MERGED') {
    return { kind: 'invalid', reason: 'gh returned an unknown pull request state' }
  }
  const state: PullRequestState =
    ghState === 'MERGED'
      ? 'merged'
      : ghState === 'CLOSED'
        ? 'closed'
        : raw.isDraft === true
          ? 'draft'
          : 'open'

  return {
    kind: 'found',
    pullRequest: {
      number,
      url,
      title: raw.title,
      state,
      checks,
      failingChecks: failing,
    },
  }
}

/** Parse the array returned by `gh pr list --head ... --state all --json ...`. */
export function parseGhPullRequestListResult(stdout: string): GhPullRequestListParseResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(stdout) as unknown
  } catch {
    return { kind: 'invalid', reason: 'gh returned malformed JSON' }
  }
  if (!Array.isArray(decoded)) {
    return { kind: 'invalid', reason: 'gh returned a non-array pull request result' }
  }
  if (decoded.length === 0) return { kind: 'none' }
  if (decoded.length !== 1) {
    return { kind: 'invalid', reason: 'gh returned multiple pull requests for one branch' }
  }
  const parsed = parseGhPullRequestResult(JSON.stringify(decoded[0]))
  return parsed.kind === 'found' ? parsed : { kind: 'invalid', reason: parsed.reason }
}

/** Parse legacy single-object output. Returns null for no/invalid data. */
export function parseGhPullRequest(stdout: string): RunPullRequest | null {
  const result = parseGhPullRequestResult(stdout)
  return result.kind === 'found' ? result.pullRequest : null
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
