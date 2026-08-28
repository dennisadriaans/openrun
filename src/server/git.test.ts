import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, it } from 'node:test'
import {
  captureBaseSnapshot,
  changedFiles,
  changedFilesAsync,
  commit,
  createPullRequest,
  discard,
  discardHunk,
  fileDiff,
  push,
} from './git.ts'
import { missingOriginRemoteMessage } from '../lib/gitActionGate.ts'

const repos: string[] = []

function git(cwd: string, args: string[]) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`)
  }
  return res.stdout.trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentops-git-test-'))
  repos.push(dir)
  git(dir, ['init'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  writeFileSync(join(dir, 'tracked.txt'), 'base\n')
  writeFileSync(join(dir, 'clean.txt'), 'clean\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-m', 'init'])
  return dir
}

afterEach(() => {
  while (repos.length > 0) {
    const dir = repos.pop()!
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('captureBaseSnapshot', () => {
  it('leaves worktree and index unchanged', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'dirty\n')
    writeFileSync(join(cwd, 'untracked.txt'), 'u\n')
    const beforeStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).stdout

    const snap = captureBaseSnapshot(cwd)
    assert.ok(snap.length > 0)

    const afterStatus = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).stdout
    assert.equal(afterStatus, beforeStatus)
    assert.equal(readFileSync(join(cwd, 'tracked.txt'), 'utf8'), 'dirty\n')
    assert.ok(existsSync(join(cwd, 'untracked.txt')))
  })

  it('includes untracked files in the snapshot tree', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'untracked.txt'), 'u\n')
    const snap = captureBaseSnapshot(cwd)
    const listed = git(cwd, ['ls-tree', '-r', '--name-only', snap])
    assert.ok(listed.split('\n').includes('untracked.txt'))
  })
})

describe('changedFiles since snapshot', () => {
  it('excludes pre-existing dirt until modified after snapshot', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'user\n')
    writeFileSync(join(cwd, 'pre.txt'), 'pre\n')
    const snap = captureBaseSnapshot(cwd)

    assert.deepEqual(
      changedFiles(cwd, snap).map((f) => f.path),
      [],
    )

    writeFileSync(join(cwd, 'agent.txt'), 'new\n')
    writeFileSync(join(cwd, 'tracked.txt'), 'user+agent\n')

    const paths = changedFiles(cwd, snap)
      .map((f) => f.path)
      .sort()
    assert.deepEqual(paths, ['agent.txt', 'tracked.txt'])
    assert.ok(!paths.includes('pre.txt'))
    assert.ok(!paths.includes('clean.txt'))
  })

  it('matches the sync listing on the async path', async () => {
    const cwd = makeRepo()
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'tracked.txt'), 'edited\n')
    writeFileSync(join(cwd, 'new.txt'), 'x\n')
    const syncPaths = changedFiles(cwd, snap)
      .map((f) => f.path)
      .sort()
    const asyncPaths = (await changedFilesAsync(cwd, snap)).map((f) => f.path).sort()
    assert.deepEqual(asyncPaths, syncPaths)
  })

  it('includes new untracked and modified tracked files', () => {
    const cwd = makeRepo()
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'tracked.txt'), 'edited\n')
    writeFileSync(join(cwd, 'new.txt'), 'x\n')

    const byPath = Object.fromEntries(changedFiles(cwd, snap).map((f) => [f.path, f]))
    assert.equal(byPath['tracked.txt']?.status, 'modified')
    assert.equal(byPath['new.txt']?.status, 'untracked')
  })

  it('includes deleted tracked files', () => {
    const cwd = makeRepo()
    const snap = captureBaseSnapshot(cwd)
    rmSync(join(cwd, 'tracked.txt'))

    const entry = changedFiles(cwd, snap).find((f) => f.path === 'tracked.txt')
    assert.equal(entry?.status, 'deleted')
  })
})

describe('commit scoped to run delta', () => {
  it('stages only run-delta paths; pre-dirty file remains unstaged', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'user\n')
    writeFileSync(join(cwd, 'pre.txt'), 'pre\n')
    const snap = captureBaseSnapshot(cwd)

    writeFileSync(join(cwd, 'agent.txt'), 'agent\n')
    writeFileSync(join(cwd, 'tracked.txt'), 'user+agent\n')

    const deltaPaths = changedFiles(cwd, snap)
      .map((f) => f.path)
      .filter((p) => changedFiles(cwd).some((d) => d.path === p))

    commit(cwd, 'run work', deltaPaths)

    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf8',
    }).stdout
    assert.match(status, /\?\? pre\.txt/)
    assert.doesNotMatch(status, /agent\.txt/)
    assert.equal(readFileSync(join(cwd, 'tracked.txt'), 'utf8'), 'user+agent\n')
  })
})

describe('discard scoped to run delta', () => {
  it('restores only run-delta; pre-dirty file survives', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'user\n')
    writeFileSync(join(cwd, 'pre.txt'), 'pre\n')
    const snap = captureBaseSnapshot(cwd)

    writeFileSync(join(cwd, 'agent.txt'), 'agent\n')
    writeFileSync(join(cwd, 'tracked.txt'), 'user+agent\n')
    writeFileSync(join(cwd, 'clean.txt'), 'touched by agent\n')

    discard(cwd, undefined, snap)

    assert.equal(readFileSync(join(cwd, 'tracked.txt'), 'utf8'), 'user\n')
    assert.equal(readFileSync(join(cwd, 'clean.txt'), 'utf8'), 'clean\n')
    assert.equal(readFileSync(join(cwd, 'pre.txt'), 'utf8'), 'pre\n')
    assert.ok(!existsSync(join(cwd, 'agent.txt')))
  })
})

describe('fileDiff since snapshot', () => {
  it('diffs against the snapshot, not HEAD alone', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'user\n')
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'tracked.txt'), 'user\nagent\n')

    const diff = fileDiff(cwd, 'tracked.txt', snap)
    assert.match(diff, /\+agent/)
    assert.doesNotMatch(diff, /^-base/)
  })
})

describe('discardHunk', () => {
  it('reverts one hunk and leaves the other', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'multi.txt'), 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n')
    git(cwd, ['add', 'multi.txt'])
    git(cwd, ['commit', '-m', 'multi'])
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'multi.txt'), 'A\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n')

    const before = parseHunkCount(fileDiff(cwd, 'multi.txt', snap))
    assert.equal(before, 2)

    discardHunk(cwd, 'multi.txt', 0, snap)
    assert.equal(readFileSync(join(cwd, 'multi.txt'), 'utf8'), 'a\nb\nc\nd\ne\nf\ng\nh\ni\nJ\n')

    discardHunk(cwd, 'multi.txt', 0, snap)
    assert.equal(readFileSync(join(cwd, 'multi.txt'), 'utf8'), 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n')
  })

  it('removes a new file when its only hunk is undone', () => {
    const cwd = makeRepo()
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'agent.txt'), 'new\n')
    discardHunk(cwd, 'agent.txt', 0, snap)
    assert.ok(!existsSync(join(cwd, 'agent.txt')))
  })
})

function parseHunkCount(diff: string): number {
  return diff.split('\n').filter((line) => line.startsWith('@@ ')).length
}

describe('push / createPullRequest origin gate', () => {
  it('push refuses a repo with no origin remote', () => {
    const cwd = makeRepo()
    assert.throws(
      () => push(cwd),
      (err: Error) => err.message === missingOriginRemoteMessage(),
    )
  })

  it('createPullRequest refuses a repo with no origin before calling gh', () => {
    const cwd = makeRepo()
    assert.throws(
      () => createPullRequest({ cwd, title: 't', body: 'b' }),
      (err: Error) => err.message === missingOriginRemoteMessage(),
    )
  })
})
