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
  it('attaches existing worktrees and marks unattached git branches as pending', () => {
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
    assert.equal(rows[0]?.id, 'ws-main')
    assert.equal(rows[0]?.hint, 'main checkout')
    assert.equal(rows[1]?.id, pendingGitBranchId('feat'))
    assert.equal(rows[1]?.hint, 'remote — open worktree')
    assert.equal(rows[2]?.id, 'ws-orphan')
    assert.equal(rows[2]?.branch, 'hotfix')
  })

  it('blocks workspaces that are still setting up', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [{ id: 'ws-1', branch: 'feat', status: 'creating' }],
    })
    assert.equal(rows[0]?.id, 'ws-1')
    assert.equal(rows[0]?.blockedReason, 'setting up')
  })

  it('blocks workspaces that already have an active run', () => {
    const rows = projectBranchChoices({
      gitBranches: [{ name: 'feat', lastCommitAt: 1, current: false, remote: false }],
      workspaces: [{ id: 'ws-1', branch: 'feat', status: 'ready', activeRunId: 'run-active' }],
    })
    assert.equal(rows[0]?.id, 'ws-1')
    assert.equal(rows[0]?.blockedReason, 'run active')
  })
})

describe('pendingGitBranchId', () => {
  it('round-trips the git: prefix', () => {
    assert.equal(parsePendingGitBranchId(pendingGitBranchId('feat/x')), 'feat/x')
    assert.equal(parsePendingGitBranchId('ws_abc'), null)
  })
})
