import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractHunkPatch, matchDiffPath, parseUnifiedDiff } from './diff.ts'

const TWO_HUNKS = `diff --git a/file.ts b/file.ts
index 1111111..2222222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old
+new
 line3
@@ -10,3 +10,3 @@
 line10
-old2
+new2
 line12
`

describe('extractHunkPatch', () => {
  it('keeps file headers and only the requested hunk', () => {
    const first = extractHunkPatch(TWO_HUNKS, 0)
    const second = extractHunkPatch(TWO_HUNKS, 1)
    assert.ok(first)
    assert.ok(second)
    assert.match(first, /diff --git a\/file\.ts b\/file\.ts/)
    assert.match(first, /@@ -1,3 \+1,3 @@/)
    assert.match(first, /\+new/)
    assert.doesNotMatch(first, /\+new2/)
    assert.match(second, /@@ -10,3 \+10,3 @@/)
    assert.match(second, /\+new2/)
    assert.doesNotMatch(second, /\+new\n/)
    assert.equal(parseUnifiedDiff(first).hunks.length, 1)
    assert.equal(parseUnifiedDiff(second).hunks.length, 1)
  })

  it('returns null for a missing hunk or a binary patch', () => {
    assert.equal(extractHunkPatch(TWO_HUNKS, 2), null)
    assert.equal(extractHunkPatch('', 0), null)
    assert.equal(extractHunkPatch('diff --git a/x b/x\nBinary files a/x and b/x differ\n', 0), null)
  })
})

describe('matchDiffPath', () => {
  it('matches an exact path or an absolute tool path to a repo-relative file', () => {
    const files = ['src/lib/diff.ts', 'README.md']
    assert.equal(matchDiffPath('src/lib/diff.ts', files), 'src/lib/diff.ts')
    assert.equal(matchDiffPath('/Users/dev/app/src/lib/diff.ts', files), 'src/lib/diff.ts')
    assert.equal(matchDiffPath('missing.ts', files), undefined)
  })
})
