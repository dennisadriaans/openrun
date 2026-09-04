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
  cloneRepo,
  commit,
  createBranch,
  createPullRequest,
  discard,
  discardHunk,
  fileDiff,
  pullRequestForBranchAsync,
  push,
  resetWorktree,
  resolveCommit,
  WHOLE_FILE_CONTEXT,
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

describe('resetWorktree', () => {
  it('resets local commits to the recorded base while keeping the configured branch', () => {
    const cwd = makeRepo()
    const base = resolveCommit(cwd, 'HEAD')
    git(cwd, ['checkout', '-q', '-b', 'openrun/feature'])
    writeFileSync(join(cwd, 'tracked.txt'), 'agent commit\n')
    git(cwd, ['add', 'tracked.txt'])
    git(cwd, ['commit', '-qm', 'agent local commit'])
    writeFileSync(join(cwd, 'untracked.txt'), 'leftover\n')

    resetWorktree(cwd, 'openrun/feature', base)

    assert.equal(git(cwd, ['rev-parse', 'HEAD']), base)
    assert.equal(git(cwd, ['branch', '--show-current']), 'openrun/feature')
    assert.equal(git(cwd, ['status', '--porcelain']), '')
    assert.equal(existsSync(join(cwd, 'untracked.txt')), false)
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

describe('fileDiff whole-file context', () => {
  /** Two edits far apart, so the default 3 lines of context cannot bridge them. */
  function repoWithDistantEdits() {
    const cwd = makeRepo()
    const lines = Array.from({ length: 40 }, (_, i) => `line${i + 1}`)
    writeFileSync(join(cwd, 'wide.txt'), `${lines.join('\n')}\n`)
    git(cwd, ['add', 'wide.txt'])
    git(cwd, ['commit', '-m', 'wide'])
    const snap = captureBaseSnapshot(cwd)
    lines[0] = 'FIRST'
    lines[39] = 'LAST'
    writeFileSync(join(cwd, 'wide.txt'), `${lines.join('\n')}\n`)
    return { cwd, snap }
  }

  it('merges every hunk into one carrying the whole file', () => {
    const { cwd, snap } = repoWithDistantEdits()

    assert.equal(parseHunkCount(fileDiff(cwd, 'wide.txt', snap)), 2)

    const whole = fileDiff(cwd, 'wide.txt', snap, WHOLE_FILE_CONTEXT)
    assert.equal(parseHunkCount(whole), 1)
    // The untouched middle of the file rides along as context.
    assert.match(whole, /^ line20$/m)
    assert.match(whole, /^\+FIRST$/m)
    assert.match(whole, /^\+LAST$/m)
  })

  it('leaves the default context unchanged when no width is asked for', () => {
    const { cwd, snap } = repoWithDistantEdits()
    const diff = fileDiff(cwd, 'wide.txt', snap)
    assert.doesNotMatch(diff, /^ line20$/m)
  })

  it('shows an untracked file whole', () => {
    const cwd = makeRepo()
    const snap = captureBaseSnapshot(cwd)
    writeFileSync(join(cwd, 'agent.txt'), 'one\ntwo\nthree\n')

    const whole = fileDiff(cwd, 'agent.txt', snap, WHOLE_FILE_CONTEXT)
    assert.equal(parseHunkCount(whole), 1)
    assert.match(whole, /^\+two$/m)
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

describe('git argv leading-dash refusal', () => {
  it('createBranch refuses a name that starts with -', () => {
    const cwd = makeRepo()
    assert.throws(() => createBranch(cwd, '--help'), /Invalid branch name/)
  })

  it('cloneRepo refuses a URL that starts with -', async () => {
    const dest = join(makeRepo(), 'clone-dest')
    await assert.rejects(() => cloneRepo({ url: '--upload-pack=true', dest }), /Invalid clone URL/)
  })
})

describe('push / createPullRequest origin gate', () => {
  it('push refuses a repo with no origin remote', async () => {
    const cwd = makeRepo()
    await assert.rejects(
      () => push(cwd),
      (err: Error) => err.message === missingOriginRemoteMessage(),
    )
  })

  it('createPullRequest refuses a repo with no origin before calling gh', async () => {
    const cwd = makeRepo()
    await assert.rejects(
      () => createPullRequest({ cwd, title: 't', body: 'b' }),
      (err: Error) => err.message === missingOriginRemoteMessage(),
    )
  })
})

function ghPullRequest(state: string, isDraft = false): string {
  return JSON.stringify([
    {
      number: 7,
      url: 'https://github.com/example/project/pull/7',
      title: 'Ship it',
      state,
      isDraft,
      statusCheckRollup: [],
    },
  ])
}

describe('pullRequestForBranchAsync', () => {
  it('probes the exact persisted branch, including settled PR states', async () => {
    const branches: string[] = []
    for (const [state, draft, expected] of [
      ['OPEN', false, 'open'],
      ['OPEN', true, 'draft'],
      ['MERGED', false, 'merged'],
      ['CLOSED', false, 'closed'],
    ] as const) {
      const result = await pullRequestForBranchAsync('/old/worktree', 'feature/finished', {
        isRepo: () => true,
        ghStatus: async () => ({ installed: true, authenticated: true }),
        run: async (_cwd, args) => {
          branches.push(args[3] ?? '')
          return { status: 0, stdout: ghPullRequest(state, draft), stderr: '' }
        },
      })
      assert.equal(result.kind, 'found')
      if (result.kind === 'found') assert.equal(result.pullRequest.state, expected)
    }
    assert.deepEqual(branches, [
      'feature/finished',
      'feature/finished',
      'feature/finished',
      'feature/finished',
    ])
  })

  it('treats an empty list as authoritative none', async () => {
    const result = await pullRequestForBranchAsync('repo', 'feature/no-pr', {
      isRepo: () => true,
      ghStatus: async () => ({ installed: true, authenticated: true }),
      run: async () => ({ status: 0, stdout: '[]', stderr: '' }),
    })
    assert.deepEqual(result, { kind: 'none' })
  })

  it('reports missing repository, branch, gh and auth as errors', async () => {
    const noRepo = await pullRequestForBranchAsync('missing', 'feature/x', {
      isRepo: () => false,
    })
    assert.equal(noRepo.kind, 'error')

    const noBranch = await pullRequestForBranchAsync('repo', '', { isRepo: () => true })
    assert.equal(noBranch.kind, 'error')

    const noGh = await pullRequestForBranchAsync('repo', 'feature/x', {
      isRepo: () => true,
      ghStatus: async () => ({ installed: false, authenticated: false }),
    })
    assert.equal(noGh.kind, 'error')

    const noAuth = await pullRequestForBranchAsync('repo', 'feature/x', {
      isRepo: () => true,
      ghStatus: async () => ({ installed: true, authenticated: false }),
    })
    assert.equal(noAuth.kind, 'error')
  })

  it('reports timeout, nonzero and malformed gh results as errors', async () => {
    const common = {
      isRepo: () => true,
      ghStatus: async () => ({ installed: true, authenticated: true }),
    }
    const timeout = await pullRequestForBranchAsync('repo', 'feature/x', {
      ...common,
      run: async () => ({ status: null, stdout: '', stderr: '', timedOut: true }),
    })
    assert.match(timeout.kind === 'error' ? timeout.reason : '', /timed out/)

    const failed = await pullRequestForBranchAsync('repo', 'feature/x', {
      ...common,
      run: async () => ({ status: 1, stdout: '', stderr: 'network down' }),
    })
    assert.match(failed.kind === 'error' ? failed.reason : '', /network down/)

    for (const stdout of ['bad json', 'null', '{}', '[null, null]']) {
      const malformed = await pullRequestForBranchAsync('repo', 'feature/x', {
        ...common,
        run: async () => ({ status: 0, stdout, stderr: '' }),
      })
      assert.equal(malformed.kind, 'error', stdout)
    }
  })
})

describe('fileDiff path confinement', () => {
  it('diffs a file inside the workspace', () => {
    const cwd = makeRepo()
    writeFileSync(join(cwd, 'tracked.txt'), 'changed\n')
    const diff = fileDiff(cwd, 'tracked.txt')
    assert.match(diff, /changed/)
  })

  it('refuses a path that escapes the workspace', () => {
    const cwd = makeRepo()
    assert.throws(() => fileDiff(cwd, '../outside.ts'), /escapes/)
  })

  it('refuses an absolute path outside the workspace', () => {
    const cwd = makeRepo()
    assert.throws(() => fileDiff(cwd, '/etc/passwd'), /escapes/)
  })
})

describe('changed files inside a submodule', () => {
  /** Superproject with a checked-out `app` submodule, both committed. */
  function makeSuperproject(): { cwd: string; sub: string } {
    const subOrigin = makeRepo()
    // A submodule needs a URL git can clone from; a local path is enough.
    const cwd = makeRepo()
    git(cwd, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', subOrigin, 'app'])
    git(cwd, ['commit', '-m', 'add submodule'])
    return { cwd, sub: join(cwd, 'app') }
  }

  it('lists files changed inside the submodule, not the gitlink', () => {
    const { cwd, sub } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)

    writeFileSync(join(sub, 'tracked.txt'), 'edited in submodule\n')
    writeFileSync(join(sub, 'fresh.txt'), 'new\n')

    const files = changedFiles(cwd, base)
    const paths = files.map((f) => f.path)

    assert.deepEqual(paths, ['app/fresh.txt', 'app/tracked.txt'])
    // The bare gitlink row is what used to be reported instead.
    assert.ok(!paths.includes('app'))

    const tracked = files.find((f) => f.path === 'app/tracked.txt')!
    assert.equal(tracked.status, 'modified')
    assert.equal(tracked.additions, 1)
    assert.equal(tracked.deletions, 1)

    assert.equal(files.find((f) => f.path === 'app/fresh.txt')!.status, 'untracked')
  })

  it('reports the same files asynchronously', async () => {
    const { cwd, sub } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)
    writeFileSync(join(sub, 'tracked.txt'), 'edited in submodule\n')

    const files = await changedFilesAsync(cwd, base)
    assert.deepEqual(
      files.map((f) => f.path),
      ['app/tracked.txt'],
    )
  })

  it('still reports superproject changes alongside submodule ones', () => {
    const { cwd, sub } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)

    writeFileSync(join(cwd, 'tracked.txt'), 'edited in super\n')
    writeFileSync(join(sub, 'tracked.txt'), 'edited in submodule\n')

    assert.deepEqual(
      changedFiles(cwd, base).map((f) => f.path),
      ['app/tracked.txt', 'tracked.txt'],
    )
  })

  it('diffs a file through the submodule that owns it', () => {
    const { cwd, sub } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)
    writeFileSync(join(sub, 'tracked.txt'), 'edited in submodule\n')

    const diff = fileDiff(cwd, 'app/tracked.txt', base)
    assert.match(diff, /edited in submodule/)
  })

  it('refuses to undo a path inside a submodule', () => {
    const { cwd, sub } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)
    writeFileSync(join(sub, 'tracked.txt'), 'edited in submodule\n')

    assert.throws(() => discard(cwd, ['app/tracked.txt'], base), /submodule/)
    assert.throws(() => discardHunk(cwd, 'app/tracked.txt', 0, base), /submodule/)
    // The refusal must not have touched the file.
    assert.equal(readFileSync(join(sub, 'tracked.txt'), 'utf8'), 'edited in submodule\n')
  })

  it('reports nothing when the submodule is untouched', () => {
    const { cwd } = makeSuperproject()
    const base = captureBaseSnapshot(cwd)
    assert.deepEqual(changedFiles(cwd, base), [])
  })
})
