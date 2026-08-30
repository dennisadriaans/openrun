import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupThreadLensRuns, type ThreadLensRun } from './threadLens.ts'

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
})
