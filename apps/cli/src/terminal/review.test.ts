import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  diffRows,
  displayPath,
  fitPath,
  reviewView,
  statusMark,
  type RunWorkspaceView,
} from './review.ts'

const workspace = (overrides: Partial<RunWorkspaceView> = {}): RunWorkspaceView => ({
  files: [
    {
      path: 'foo.html',
      oldPath: null,
      status: 'untracked',
      additions: 3,
      deletions: 0,
      binary: false,
    },
  ],
  repo: { isRepo: true, branch: 'main', head: 'abc1234', remote: 'git@x:y.git', ahead: 0 },
  totals: { additions: 3, deletions: 0 },
  gh: { installed: true, authenticated: true },
  baseBranch: 'main',
  ...overrides,
})

test('a review names where the run worked and what it changed', () => {
  const view = reviewView({
    run: { id: 'r1', taskName: 'create foo.html', status: 'success', cwd: '/home/me/dev/site' },
    workspace: workspace(),
  })
  assert.equal(view.title, 'create foo.html')
  assert.equal(view.status, 'Success')
  assert.equal(view.branch, 'main @ abc1234')
  assert.equal(view.summary, '1 file +3 −0')
  assert.equal(view.details, 'default model · default effort')
  assert.equal(
    reviewView({ run: { id: 'r2', model: 'claude-sonnet-5', effort: 'low' }, workspace: null })
      .details,
    'claude-sonnet-5 · low effort',
  )
  assert.deepEqual(view.blocked, { commit: null, discard: null, push: null, ship: null })
  assert.equal(statusMark(view.files[0]!.status), 'A')
  assert.equal(displayPath('/home/me/dev/site', '/home/me'), '~/dev/site')
  assert.equal(displayPath('/home/meadow/x', '/home/me'), '/home/meadow/x')
  assert.equal(fitPath('src/terminal/review.ts', 12), '…l/review.ts')
  assert.equal(fitPath('foo.html', 12), 'foo.html')
})

test('writes are blocked with the web panel’s reasons', () => {
  const clean = reviewView({
    run: { id: 'r1' },
    workspace: workspace({
      files: [],
      totals: { additions: 0, deletions: 0 },
      repo: { isRepo: true, branch: 'feat/x', head: '', remote: '', ahead: 2 },
    }),
  })
  assert.equal(clean.summary, 'No file changes')
  assert.equal(clean.branch, 'feat/x · started on main · 2 unpushed commits')
  assert.match(clean.blocked.commit!, /Working tree clean/)
  assert.match(clean.blocked.push!, /No origin remote/)
  assert.match(clean.blocked.ship!, /No origin remote/)

  const loose = reviewView({
    run: { id: 'r2', cwd: '/tmp/scratch' },
    workspace: workspace({
      repo: { isRepo: false, branch: '', head: '', remote: '', ahead: 0 },
    }),
  })
  assert.match(loose.summary, /not a git repository/)
  assert.equal(loose.blocked.discard, loose.summary)
})

test('diff rows number lines, strip terminal escapes and cap huge files', () => {
  const raw = [
    'diff --git a/a.ts b/a.ts',
    '@@ -1,2 +1,2 @@ function main',
    ' keep',
    '-old\t1',
    '+new \x1b[31mred\x1b[0m',
    '',
  ].join('\n')
  assert.deepEqual(diffRows(raw), [
    { kind: 'hunk', number: '', text: '@@ −1 +1 @@ function main' },
    { kind: 'context', number: '1', text: 'keep' },
    { kind: 'delete', number: '2', text: 'old  1' },
    { kind: 'add', number: '2', text: 'new red' },
  ])
  assert.equal(diffRows('Binary files a/x.png and b/x.png differ')[0]!.kind, 'note')
  const many = ['@@ -0,0 +1,5 @@', ...Array.from({ length: 5 }, (_, i) => `+${i}`)].join('\n')
  const capped = diffRows(many, 2)
  assert.equal(capped.length, 4)
  assert.equal(capped.at(-1)!.text, '… 3 more lines not shown.')
})
