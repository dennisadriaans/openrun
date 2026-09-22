import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseGitForEachRef,
  parsePendingGitBranchId,
  pendingGitBranchId,
  projectBranchChoices,
} from './gitBranches.ts'

describe('parseGitForEachRef', () => {
  it('prefers local refs, skips remote HEAD, and sorts by recency', () => {
    const stdout = [
      '100\trefs/remotes/origin/HEAD\t',
      '200\trefs/remotes/origin/feat\t',
      '150\trefs/heads/main\t*',
      '180\trefs/remotes/origin/main\t',
      '90\trefs/heads/old\t',
    ].join('\n')
    const rows = parseGitForEachRef(stdout)
    assert.deepEqual(
      rows.map((r) => r.name),
      ['feat', 'main', 'old'],
    )
    const feat = rows.find((r) => r.name === 'feat')
    assert.equal(feat?.remote, true)
    const main = rows.find((r) => r.name === 'main')
    assert.equal(main?.remote, false)
    assert.equal(main?.current, true)
    assert.equal(main?.lastCommitAt, 180_000)
  })

  it('returns empty for junk', () => {
    assert.deepEqual(parseGitForEachRef(''), [])
    assert.deepEqual(parseGitForEachRef('not-a-ref'), [])
  })
})

describe('projectBranchChoices', () => {
  it('separates existing workspaces from branches that create one', () => {
    const rows = projectBranchChoices({
      gitBranches: [
        { name: 'main', lastCommitAt: 2, current: true, remote: false },
        { name: 'feat', lastCommitAt: 1, current: false, remote: true },
      ],
      workspaces: [
        { id: 'ws-main', branch: 'main', kind: 'main', status: 'ready' },
        { id: 'ws-orphan', branch: 'hotfix', kind: 'worktree', status: 'ready' },
      ],
    })
    const main = rows.find((row) => row.id === 'ws-main')
    assert.equal(main?.action, 'select-workspace')
    assert.equal(main?.hint, 'Shared main checkout')
    const feat = rows.find((row) => row.id === pendingGitBranchId('feat'))
    assert.equal(feat?.action, 'create-workspace')
    assert.match(feat?.hint ?? '', /new isolated workspace/i)
    assert.equal(rows.find((row) => row.id === 'ws-orphan')?.branch, 'hotfix')
  })

  it('blocks workspaces that are still setting up', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [{ id: 'ws-1', branch: 'feat', status: 'creating' }],
    })
    assert.match(rows[0]?.blockedReason ?? '', /setting up/i)
  })

  it('shows duplicate workspace rows instead of hiding the broken one', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [
        { id: 'ws-deleted', branch: 'feat', kind: 'worktree', status: 'error' },
        { id: 'ws-main', branch: 'feat', kind: 'main', status: 'ready' },
      ],
    })
    assert.equal(rows.filter((row) => row.action === 'select-workspace').length, 2)
    assert.equal(rows.find((row) => row.id === 'ws-main')?.blockedReason, null)
    assert.match(rows.find((row) => row.id === 'ws-deleted')?.blockedReason ?? '', /failed/i)
  })

  it('keeps a ready duplicate selectable while another is creating', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [
        { id: 'ws-creating', branch: 'feat', kind: 'worktree', status: 'creating' },
        { id: 'ws-ready', branch: 'feat', kind: 'worktree', status: 'ready' },
      ],
    })
    assert.equal(rows.find((row) => row.id === 'ws-ready')?.blockedReason, null)
    assert.match(rows.find((row) => row.id === 'ws-creating')?.blockedReason ?? '', /setting up/i)
  })

  it('blocks workspaces that already have an active run', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [{ id: 'ws-1', branch: 'feat', status: 'ready', activeRunId: 'run-active' }],
    })
    assert.equal(rows[0]?.id, 'ws-1')
    assert.match(rows[0]?.blockedReason ?? '', /active run/i)
  })

  it('never revives an archived workspace as a selected picker option', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [{ id: 'ws-old', branch: 'feat', kind: 'worktree', status: 'archived' }],
      selectedWorkspaceId: 'ws-old',
    })
    assert.equal(
      rows.some((row) => row.id === 'ws-old'),
      false,
    )
    assert.equal(rows[0]?.action, 'create-workspace')
  })

  it('hides the branch in the primary checkout but keeps an existing worktree', () => {
    const rows = projectBranchChoices({
      gitBranches: [
        { name: 'main', lastCommitAt: 2, current: true, remote: false },
        { name: 'feat', lastCommitAt: 1, current: false, remote: false },
      ],
      workspaces: [{ id: 'ws-feat', branch: 'feat', kind: 'worktree', status: 'ready' }],
    })
    assert.equal(
      rows.some((row) => row.branch === 'main'),
      false,
    )
    assert.equal(
      rows.some((row) => row.id === 'ws-feat'),
      true,
    )

    const existing = projectBranchChoices({
      gitBranches: [{ name: 'main', lastCommitAt: 2, current: false, remote: false }],
      workspaces: [{ id: 'ws-main', branch: 'main', kind: 'worktree', status: 'ready' }],
    })
    assert.equal(existing[0]?.id, 'ws-main')
  })

  it('explains physical, ownership, and contamination blockers for unattended use', () => {
    const rows = projectBranchChoices({
      gitBranches: [],
      workspaces: [
        { id: 'missing', branch: 'a', status: 'ready', exists: false },
        {
          id: 'owned',
          branch: 'b',
          status: 'ready',
          unattendedOwnerName: 'Nightly docs',
        },
        { id: 'dirty', branch: 'c', status: 'ready', dirty: true },
      ],
      unattended: true,
    })
    assert.match(rows.find((row) => row.id === 'missing')?.blockedReason ?? '', /missing/i)
    assert.match(rows.find((row) => row.id === 'owned')?.blockedReason ?? '', /Nightly docs/)
    assert.match(rows.find((row) => row.id === 'dirty')?.blockedReason ?? '', /uncommitted/i)
  })
})

describe('pendingGitBranchId', () => {
  it('round-trips the git: prefix', () => {
    assert.equal(parsePendingGitBranchId(pendingGitBranchId('feat/x')), 'feat/x')
    assert.equal(parsePendingGitBranchId('ws_abc'), null)
  })
})
