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

/** Order conversations spatially: current worktree, sibling worktrees, then projects. */
export function groupThreadLensRuns(
  runs: ThreadLensRun[],
  current: { workspaceId: string; projectId: string },
  query = '',
): ThreadLensGroup[] {
  const needle = query.trim().toLocaleLowerCase()
  const matching = needle
    ? runs.filter((run) =>
        [run.chatTitle, run.runtimeLabel, run.workspaceBranch, run.projectName].some((value) =>
          value.toLocaleLowerCase().includes(needle),
        ),
      )
    : runs
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
