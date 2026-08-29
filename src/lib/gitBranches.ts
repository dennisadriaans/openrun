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
}

/**
 * Several workspaces can carry the same branch — the main checkout plus a
 * worktree someone deleted from disk. Rank so a usable row wins the picker
 * slot; a dead worktree must not shadow a branch that is fine to run on.
 */
function branchSeedRank(ws: WorkspaceBranchSeed): number {
  if (ws.status === 'error') return 3
  if (ws.status === 'creating') return 2
  if (ws.kind === 'main') return 0
  return 1
}

function workspaceHint(ws: WorkspaceBranchSeed): string | undefined {
  if (ws.kind === 'main') return 'main checkout'
  if (ws.status === 'creating') return 'setting up'
  if (ws.status === 'error') return 'setup failed'
  return undefined
}

function workspaceBlocked(ws: WorkspaceBranchSeed): string | null {
  if (ws.status === 'creating') return 'setting up'
  if (ws.status === 'error') return 'setup failed'
  if (ws.status === 'archived') return 'archived'
  if (ws.activeRunId) return 'run active'
  return null
}

/**
 * Recent git branches, wired to an existing worktree when one already tracks
 * that name. Unattached names keep a `git:` id so the form can create a
 * worktree on pick.
 */
export function projectBranchChoices(input: {
  gitBranches: GitBranchRow[]
  workspaces: WorkspaceBranchSeed[]
}): ProjectBranchChoice[] {
  const active = input.workspaces.filter((w) => w.status !== 'archived')
  const byBranch = new Map<string, WorkspaceBranchSeed>()
  for (const ws of active) {
    const existing = byBranch.get(ws.branch)
    if (!existing || branchSeedRank(ws) < branchSeedRank(existing)) byBranch.set(ws.branch, ws)
  }

  const seen = new Set<string>()
  const out: ProjectBranchChoice[] = []

  for (const git of input.gitBranches) {
    seen.add(git.name)
    const ws = byBranch.get(git.name)
    if (ws) {
      out.push({
        id: ws.id,
        branch: git.name,
        kind: ws.kind ?? undefined,
        status: ws.status,
        blockedReason: workspaceBlocked(ws),
        hint: workspaceHint(ws) ?? (git.current ? 'checked out' : undefined),
      })
      continue
    }
    out.push({
      id: pendingGitBranchId(git.name),
      branch: git.name,
      hint: git.remote ? 'remote — open worktree' : 'open worktree',
    })
  }

  for (const ws of active) {
    if (seen.has(ws.branch)) continue
    seen.add(ws.branch)
    out.push({
      id: ws.id,
      branch: ws.branch,
      kind: ws.kind ?? undefined,
      status: ws.status,
      blockedReason: workspaceBlocked(ws),
      hint: workspaceHint(ws),
    })
  }

  return out
}
