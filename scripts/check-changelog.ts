// Requires a `changelog.d/` fragment on any PR that will move the version.
//
// AGENTS.md has always asked for this in review; the release pipeline makes it
// load-bearing, because a `feat` with no fragment ships a release whose notes
// have a version but nothing to say about it.

import { commitBump, parseCommit } from './release/conventional.ts'

const title = process.env.PR_TITLE ?? ''
const body = process.env.PR_BODY ?? ''
const labels = (process.env.PR_LABELS ?? '').toLowerCase()
const changed = (process.env.CHANGED_FILES ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)

const commit = parseCommit({ sha: '', subject: title })
const bump = commitBump(commit)

if (!bump) {
  console.log(`ok: "${title}" does not move the version, so no changelog entry is needed.`)
  process.exit(0)
}

// Deliberate escape hatch: an internal-only change can carry a conventional
// type without being worth a user-facing sentence.
if (labels.includes('no changelog') || /\[skip changelog\]/i.test(body)) {
  console.log('ok: changelog entry waived (label or [skip changelog]).')
  process.exit(0)
}

const fragments = changed.filter((file) => /^changelog\.d\/.+\.md$/.test(file))

if (fragments.length === 0) {
  console.error(
    `::error::A "${commit.type}" PR moves the version (${bump}) and needs a changelog.d/ entry.`,
  )
  console.error('')
  console.error('  Add one file, named for the change, in the negative-relief voice:')
  console.error('')
  console.error('    changelog.d/bulk-automation-delete.md')
  console.error('    "You no longer delete automations one row at a time — …"')
  console.error('')
  console.error(
    '  Internal-only? Add the "no changelog" label or put [skip changelog] in the body.',
  )
  process.exit(1)
}

console.log(`ok: ${fragments.length} changelog entry/entries — ${fragments.join(', ')}`)
