export type ThreadLensRun = {
  id: string
  chatTitle: string
  runtimeLabel: string
  runtimeId: string
  startedAt: number
  workspaceId: string
  workspaceBranch: string
  projectId: string
  projectName: string
  unread: boolean
}

export type ThreadLensGroup = {
  key: string
  label: string
  kind: 'current' | 'workspace' | 'project'
  runs: ThreadLensRun[]
}

export function threadNavigationIndex(runs: ThreadLensRun[]): {
  unreadWorkspaceIds: Set<string>
  latestRunIdByWorkspace: Map<string, string>
  latestRunIdByProject: Map<string, string>
} {
  const unreadWorkspaceIds = new Set<string>()
  const latestRunIdByWorkspace = new Map<string, string>()
  const latestRunIdByProject = new Map<string, string>()
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    if (run.unread && run.workspaceId) unreadWorkspaceIds.add(run.workspaceId)
    if (run.workspaceId && !latestRunIdByWorkspace.has(run.workspaceId)) {
      latestRunIdByWorkspace.set(run.workspaceId, run.id)
    }
    if (run.projectId && !latestRunIdByProject.has(run.projectId)) {
      latestRunIdByProject.set(run.projectId, run.id)
    }
  }
  return { unreadWorkspaceIds, latestRunIdByWorkspace, latestRunIdByProject }
}

export function adjacentThreadId(
  runs: ThreadLensRun[],
  workspaceId: string,
  runId: string,
  direction: -1 | 1,
): string | null {
  const threads = runs
    .filter((run) => run.workspaceId === workspaceId)
    .sort((a, b) => b.startedAt - a.startedAt)
  if (threads.length < 2) return null
  const index = threads.findIndex((run) => run.id === runId)
  if (index < 0) return null
  return threads[(index + direction + threads.length) % threads.length]?.id ?? null
}

/**
 * Conversations for the header picker. An empty query is this worktree only;
 * a search reaches sibling worktrees and other projects.
 */
export function groupThreadLensRuns(
  runs: ThreadLensRun[],
  current: { workspaceId: string; projectId: string },
  query = '',
): ThreadLensGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  const scoped = needle ? runs : runs.filter((run) => run.workspaceId === current.workspaceId)
  const matching = needle
    ? scoped.filter((run) =>
        [run.chatTitle, run.runtimeLabel, run.workspaceBranch, run.projectName].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
      )
    : scoped
  const sorted = [...matching].sort((a, b) => b.startedAt - a.startedAt)
  const groups: ThreadLensGroup[] = []
  const add = (group: ThreadLensGroup) => {
    if (group.runs.length > 0) groups.push(group)
  }

  add({
    key: `workspace:${current.workspaceId}`,
    label: 'Current worktree',
    kind: 'current',
    runs: sorted.filter((run) => run.workspaceId === current.workspaceId),
  })

  const siblingBranches = new Map<string, ThreadLensRun[]>()
  for (const run of sorted) {
    if (run.projectId !== current.projectId || run.workspaceId === current.workspaceId) continue
    const group = siblingBranches.get(run.workspaceId) ?? []
    group.push(run)
    siblingBranches.set(run.workspaceId, group)
  }
  for (const [workspaceId, workspaceRuns] of siblingBranches) {
    add({
      key: `workspace:${workspaceId}`,
      label: workspaceRuns[0]?.workspaceBranch || 'Other worktree',
      kind: 'workspace',
      runs: workspaceRuns,
    })
  }

  const projects = new Map<string, ThreadLensRun[]>()
  for (const run of sorted) {
    if (!run.projectId || run.projectId === current.projectId) continue
    const group = projects.get(run.projectId) ?? []
    group.push(run)
    projects.set(run.projectId, group)
  }
  for (const [projectId, projectRuns] of projects) {
    add({
      key: `project:${projectId}`,
      label: projectRuns[0]?.projectName || 'Other project',
      kind: 'project',
      runs: projectRuns,
    })
  }
  return groups
}
