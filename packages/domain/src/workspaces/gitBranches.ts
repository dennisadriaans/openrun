/**
 * Recent git-branch listing — parse-only, browser-safe.
 *
 * The server runs `git for-each-ref`; these helpers turn that output (and the
 * project's existing worktrees) into picker rows so the automation form can
 * target a branch without guessing which worktree it will land in.
 */

export const RECENT_BRANCH_LIMIT = 20
export const PENDING_GIT_BRANCH_PREFIX = 'git:'

export type GitBranchRow = {
  name: string
  lastCommitAt: number
  current: boolean
  /** True when the name exists only as a remote-tracking ref. */
  remote: boolean
}

export type ProjectBranchChoice = {
  id: string
  branch: string
  /** Existing checkout, or a Git branch that will be opened in a new worktree. */
  action: 'select-workspace' | 'create-workspace'
  kind?: string
  status?: string
  blockedReason?: string | null
  hint?: string
}

export function pendingGitBranchId(name: string): string {
  return `${PENDING_GIT_BRANCH_PREFIX}${name}`
}

export function parsePendingGitBranchId(id: string): string | null {
  return id.startsWith(PENDING_GIT_BRANCH_PREFIX)
    ? id.slice(PENDING_GIT_BRANCH_PREFIX.length)
    : null
}

function skipRemoteRef(refname: string): boolean {
  return refname.endsWith('/HEAD') || /\/HEAD$/.test(refname)
}

function parseRef(refname: string): { name: string; remote: boolean } | null {
  if (refname.startsWith('refs/heads/')) {
    const name = refname.slice('refs/heads/'.length).trim()
    return name ? { name, remote: false } : null
  }
  if (refname.startsWith('refs/remotes/')) {
    if (skipRemoteRef(refname)) return null
    const rest = refname.slice('refs/remotes/'.length)
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    const name = rest.slice(slash + 1).trim()
    return name ? { name, remote: true } : null
  }
  return null
}

/**
 * `git for-each-ref --format='%(committerdate:unix)%09%(refname)%09%(HEAD)'`
 * already sorted newest-first. Local refs win over remote-tracking aliases.
 */
export function parseGitForEachRef(stdout: string, limit = RECENT_BRANCH_LIMIT): GitBranchRow[] {
  const byName = new Map<string, GitBranchRow>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [dateRaw, refname, head] = trimmed.split('\t')
    if (!refname) continue
    const parsed = parseRef(refname.trim())
    if (!parsed) continue
    const lastCommitAt = Number(dateRaw)
    const row: GitBranchRow = {
      name: parsed.name,
      lastCommitAt: Number.isFinite(lastCommitAt) ? lastCommitAt * 1000 : 0,
      current: head?.trim() === '*',
      remote: parsed.remote,
    }
    const existing = byName.get(parsed.name)
    if (!existing) {
      byName.set(parsed.name, row)
      continue
    }
    if (existing.remote && !row.remote) {
      byName.set(parsed.name, {
        ...row,
        lastCommitAt: Math.max(existing.lastCommitAt, row.lastCommitAt),
        current: existing.current || row.current,
      })
      continue
    }
    if (row.lastCommitAt > existing.lastCommitAt) {
      existing.lastCommitAt = row.lastCommitAt
    }
    existing.current = existing.current || row.current
  }
  return [...byName.values()]
    .sort((a, b) => b.lastCommitAt - a.lastCommitAt || a.name.localeCompare(b.name))
    .slice(0, limit > 0 ? limit : RECENT_BRANCH_LIMIT)
}

export type WorkspaceBranchSeed = {
  id: string
  branch: string
  kind?: string | null
  status: string
  activeRunId?: string | null
  exists?: boolean
  dirty?: boolean
  actualBranch?: string | null
  quarantineReason?: string | null
  unattendedOwnerName?: string | null
}

function workspaceHint(ws: WorkspaceBranchSeed): string | undefined {
  if (ws.kind === 'main') return 'Shared main checkout'
  if (ws.status === 'creating') return 'setting up'
  if (ws.status === 'error') return 'setup failed'
  return 'Existing isolated workspace'
}

function workspaceBlocked(
  ws: WorkspaceBranchSeed,
  policy: { unattended: boolean; requireIsolation: boolean },
): string | null {
  if (ws.status === 'creating') return 'Setting up — wait until this workspace is ready'
  if (ws.status === 'error') return 'Setup failed — repair or recreate it under Projects'
  if (ws.status === 'archived') return 'Archived — choose or create another workspace'
  if (ws.exists === false) return 'Directory missing — recreate this workspace under Projects'
  if (ws.activeRunId) return 'In use — wait for the active run to finish'
  if (!policy.unattended) return null
  if (policy.requireIsolation && ws.kind === 'main') {
    return 'Unavailable — unattended runs need an isolated workspace'
  }
  if (ws.unattendedOwnerName?.trim()) {
    return `Reserved by “${ws.unattendedOwnerName.trim()}” — create a separate workspace`
  }
  if (ws.quarantineReason?.trim()) return 'Quarantined — restore or clear it before reuse'
  if (ws.actualBranch?.trim() && ws.actualBranch !== ws.branch) {
    return `On ${ws.actualBranch} instead — restore this workspace before reuse`
  }
  if (ws.dirty) return 'Has uncommitted changes — restore or clean it before reuse'
  return null
}

/**
 * Keep existing workspaces and unopened Git branches as different choice
 * types. Selecting the latter creates a worktree, so callers can make that
 * side effect explicit instead of presenting every row as an ordinary branch.
 */
export function projectBranchChoices(input: {
  gitBranches: GitBranchRow[]
  workspaces: WorkspaceBranchSeed[]
  selectedWorkspaceId?: string
  unattended?: boolean
  requireIsolation?: boolean
}): ProjectBranchChoice[] {
  const policy = {
    unattended: input.unattended ?? false,
    requireIsolation: input.requireIsolation ?? true,
  }
  const workspaces = input.workspaces
    .filter((ws) => ws.status !== 'archived')
    .sort((a, b) => {
      if (a.id === input.selectedWorkspaceId) return -1
      if (b.id === input.selectedWorkspaceId) return 1
      if (a.status === 'ready' && b.status !== 'ready') return -1
      if (b.status === 'ready' && a.status !== 'ready') return 1
      if (a.kind === 'worktree' && b.kind === 'main') return -1
      if (b.kind === 'worktree' && a.kind === 'main') return 1
      return a.branch.localeCompare(b.branch)
    })
  const occupiedBranches = new Set(workspaces.map((ws) => ws.branch))
  const workspaceChoices = workspaces.map((ws): ProjectBranchChoice => {
    const blockedReason = workspaceBlocked(ws, policy)
    return {
      id: ws.id,
      branch: ws.branch,
      action: 'select-workspace',
      kind: ws.kind ?? undefined,
      status: ws.status,
      blockedReason,
      hint: blockedReason ?? workspaceHint(ws),
    }
  })
  const branchChoices = input.gitBranches
    // `current` is the branch in the repository's primary checkout. Git will
    // refuse to open it in another worktree, so omit it from the action list
    // instead of maintaining a second protected/default-branch policy.
    .filter((git) => !git.current && !occupiedBranches.has(git.name))
    .map(
      (git): ProjectBranchChoice => ({
        id: pendingGitBranchId(git.name),
        branch: git.name,
        action: 'create-workspace',
        hint: git.remote
          ? 'Open remote branch in a new isolated workspace'
          : 'Open branch in a new isolated workspace',
      }),
    )

  return [...workspaceChoices, ...branchChoices]
}
