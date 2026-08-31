import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planRelease } from './plan.ts'
import {
  extractRelease,
  insertRelease,
  renderReleaseNotes,
  splitChangelog,
  toBullet,
} from './notes.ts'

const REPO = 'https://github.com/dennisadriaans/openrun'

const plan = (...subjects: string[]) =>
  planRelease({
    currentVersion: '0.1.0',
    commits: subjects.map((subject, index) => ({ sha: `sha${index}`, subject })),
  })

test('renders a version heading, prose and a commit index', () => {
  const notes = renderReleaseNotes({
    plan: plan(
      'feat(tasks): select and bulk delete automations (#42)',
      'fix: repair scheduler (#7)',
    ),
    fragments: [
      { name: 'bulk-delete.md', body: 'You no longer delete automations one at a time.' },
    ],
    repoUrl: REPO,
    previousTag: 'v0.1.0',
    date: '2026-09-07',
  })

  assert.match(notes, /^## v0\.2\.0 — 2026-09-07\n/)
  assert.match(notes, /- You no longer delete automations one at a time\./)
  assert.match(notes, /### 🚀 Features/)
  assert.match(
    notes,
    /- \*\*tasks:\*\* select and bulk delete automations \(\[#42\]\(.*\/pull\/42\)\)/,
  )
  assert.match(notes, /### 🩹 Fixes/)
  assert.match(notes, /\/compare\/v0\.1\.0\.\.\.v0\.2\.0/)
})

test('omits the compare link on a first release', () => {
  const notes = renderReleaseNotes({
    plan: plan('feat: a'),
    fragments: [],
    repoUrl: REPO,
    previousTag: null,
  })
  assert.doesNotMatch(notes, /Full changelog/)
})

test('renders PR numbers unlinked when no repo url is known', () => {
  const notes = renderReleaseNotes({ plan: plan('fix: repair scheduler (#7)'), fragments: [] })
  assert.match(notes, /- repair scheduler \(#7\)/)
})

test('calls out breaking changes and why the number was held', () => {
  const notes = renderReleaseNotes({
    plan: planRelease({
      currentVersion: '0.8.1',
      commits: [{ sha: 'a', subject: 'feat!: replace the runtime schema (#9)' }],
    }),
    fragments: [],
  })

  assert.match(notes, /1 breaking change/)
  assert.match(notes, /pre-1\.0/)
})

test('carries hand-written Unreleased bullets into the release', () => {
  const notes = renderReleaseNotes({
    plan: plan('feat: a'),
    fragments: [{ name: 'b.md', body: 'You no longer wait for the fragment.' }],
    carried: ['You no longer wait for the carried bullet.'],
  })

  const carried = notes.indexOf('carried bullet')
  const fragment = notes.indexOf('fragment')
  assert.ok(carried > -1 && fragment > -1)
  assert.ok(carried < fragment, 'carried bullets lead, fragments follow')
})

test('lists unconventional commits rather than hiding them', () => {
  const notes = renderReleaseNotes({ plan: plan('feat: a', 'Added a thing'), fragments: [] })
  assert.match(notes, /### Uncategorised/)
  assert.match(notes, /- Added a thing/)
})

test('refuses to render notes for a plan with nothing to release', () => {
  assert.throws(
    () => renderReleaseNotes({ plan: plan('docs: a'), fragments: [] }),
    /no next version/,
  )
})

test('a multi-paragraph fragment becomes one bullet with indented continuations', () => {
  const bullet = toBullet('First paragraph\nwrapped over lines.\n\nSecond paragraph.')
  assert.equal(bullet, '- First paragraph wrapped over lines.\n\n  Second paragraph.')
})

test('a fragment already written as a bullet is not double-bulleted', () => {
  assert.equal(toBullet('- You no longer do the thing.'), '- You no longer do the thing.')
})

test('an empty fragment renders nothing', () => {
  assert.equal(toBullet('   \n\n  '), '')
})

const CHANGELOG = `# Changelog

All notable changes to Open Run are documented in this file.

## Unreleased

- You no longer miss Claude Code when started from a GUI —
  PATH is discovered automatically.
- You no longer pay a poll on a healthy stream.

## [Release 2026-07-23]

Live agent runs and safer scheduling.
`

test('splits a changelog around its Unreleased section', () => {
  const split = splitChangelog(CHANGELOG)

  assert.match(split.preamble, /^# Changelog/)
  assert.doesNotMatch(split.preamble, /Unreleased/)
  assert.equal(split.carried.length, 2)
  assert.match(split.carried[0] ?? '', /^You no longer miss Claude Code/)
  assert.match(split.carried[0] ?? '', /PATH is discovered automatically\.$/)
  assert.match(split.rest, /^## \[Release 2026-07-23\]/)
})

test('splitting a changelog with no Unreleased section keeps every release', () => {
  const split = splitChangelog('# Changelog\n\nIntro.\n\n## v1.0.0\n\n- A thing.\n')
  assert.match(split.preamble, /Intro\./)
  assert.deepEqual(split.carried, [])
  assert.match(split.rest, /^## v1\.0\.0/)
})

test('inserting a release empties Unreleased and keeps older sections', () => {
  const updated = insertRelease(CHANGELOG, '## v0.2.0 — 2026-09-07\n\n- A thing shipped.\n')

  assert.match(updated, /^# Changelog/)
  // The backlog moved into the release rather than being stranded above it.
  assert.doesNotMatch(updated, /You no longer miss Claude Code/)
  assert.match(updated, /## Unreleased\n\n## v0\.2\.0 — 2026-09-07/)
  assert.match(updated, /## \[Release 2026-07-23\]/)
  assert.ok(updated.endsWith('\n'))
})

test('inserting twice keeps both releases in order', () => {
  const once = insertRelease(CHANGELOG, '## v0.2.0\n\n- First.\n')
  const twice = insertRelease(once, '## v0.3.0\n\n- Second.\n')

  assert.ok(twice.indexOf('## v0.3.0') < twice.indexOf('## v0.2.0'))
})

test('extracts one release section back out of the changelog', () => {
  const changelog = insertRelease(CHANGELOG, '## v0.2.0 — 2026-09-07\n\n- A thing shipped.\n')
  const body = extractRelease(changelog, '0.2.0')

  assert.equal(body, '- A thing shipped.')
  assert.equal(extractRelease(changelog, '9.9.9'), null)
})

test('extraction stops at the next release heading', () => {
  const twice = insertRelease(
    insertRelease(CHANGELOG, '## v0.2.0\n\n- First.\n'),
    '## v0.3.0\n\n- Second.\n',
  )

  assert.equal(extractRelease(twice, '0.3.0'), '- Second.')
  assert.equal(extractRelease(twice, '0.2.0'), '- First.')
})

test('a version is not confused with one it prefixes', () => {
  const changelog = insertRelease(CHANGELOG, '## v0.2.10\n\n- Ten.\n')
  assert.equal(extractRelease(changelog, '0.2.1'), null)
})
