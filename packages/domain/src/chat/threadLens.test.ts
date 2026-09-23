import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  adjacentThreadId,
  groupThreadLensRuns,
  threadNavigationIndex,
  type ThreadLensRun,
} from './threadLens.ts'

const run = (
  id: string,
  workspaceId: string,
  projectId: string,
  startedAt: number,
): ThreadLensRun => ({
  id,
  workspaceId,
  projectId,
  startedAt,
  chatTitle: `Thread ${id}`,
  runtimeLabel: id === 'one' ? 'Codex' : 'Claude',
  runtimeId: id === 'one' ? 'codex' : 'claude',
  workspaceBranch: workspaceId,
  projectName: projectId,
  unread: false,
})

describe('groupThreadLensRuns', () => {
  it('lists only the current worktree until you search', () => {
    const groups = groupThreadLensRuns(
      [
        run('other', 'ws-c', 'project-b', 4),
        run('sibling', 'ws-b', 'project-a', 3),
        run('one', 'ws-a', 'project-a', 2),
      ],
      { workspaceId: 'ws-a', projectId: 'project-a' },
    )
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['current'],
    )
    assert.deepEqual(
      groups[0]?.runs.map((item) => item.id),
      ['one'],
    )
  })

  it('reaches sibling worktrees and other projects when searching', () => {
    const groups = groupThreadLensRuns(
      [
        run('other', 'ws-c', 'project-b', 4),
        run('sibling', 'ws-b', 'project-a', 3),
        run('one', 'ws-a', 'project-a', 2),
      ],
      { workspaceId: 'ws-a', projectId: 'project-a' },
      'thread',
    )
    assert.deepEqual(
      groups.map((group) => group.kind),
      ['current', 'workspace', 'project'],
    )
    assert.equal(groups[0]?.runs[0]?.id, 'one')
  })

  it('searches titles, agents, worktrees, and projects', () => {
    const groups = groupThreadLensRuns(
      [run('one', 'main', 'open-run', 2), run('two', 'release', 'dashboard', 1)],
      { workspaceId: 'main', projectId: 'open-run' },
      'claude',
    )
    assert.deepEqual(
      groups.flatMap((group) => group.runs.map((item) => item.id)),
      ['two'],
    )
  })

  it('does not impose the old 200-conversation navigation boundary', () => {
    const runs = Array.from({ length: 250 }, (_, index) =>
      run(`run-${index}`, 'ws-a', 'project-a', index),
    )
    const groups = groupThreadLensRuns(runs, { workspaceId: 'ws-a', projectId: 'project-a' })
    assert.equal(groups[0]?.runs.length, 250)
    assert.equal(groups[0]?.runs[0]?.id, 'run-249')
  })
})

describe('thread navigation', () => {
  it('indexes the latest run and unread state independent of input order', () => {
    const older = run('older', 'ws-a', 'project-a', 1)
    older.unread = true
    const latest = run('latest', 'ws-a', 'project-a', 3)
    const other = run('other', 'ws-b', 'project-a', 2)
    const index = threadNavigationIndex([older, latest, other])
    assert.equal(index.latestRunIdByWorkspace.get('ws-a'), 'latest')
    assert.equal(index.latestRunIdByProject.get('project-a'), 'latest')
    assert.equal(index.unreadWorkspaceIds.has('ws-a'), true)
  })

  it('cycles within the current worktree and refuses a missing current run', () => {
    const runs = [run('latest', 'ws-a', 'project-a', 3), run('older', 'ws-a', 'project-a', 1)]
    assert.equal(adjacentThreadId(runs, 'ws-a', 'latest', 1), 'older')
    assert.equal(adjacentThreadId(runs, 'ws-a', 'latest', -1), 'older')
    assert.equal(adjacentThreadId(runs, 'ws-a', 'missing', 1), null)
  })
})
