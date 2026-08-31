// Validates a PR title against the commit rules, for the `PR title` workflow.
//
// The rules themselves live in `scripts/release/conventional.ts` alongside their
// tests, so this file is only the CI entry point — the gate and `pnpm ship`
// cannot drift into disagreeing about the same title.

import { validateCommitTitle } from './release/conventional.ts'

const title = process.argv[2] ?? process.env.PR_TITLE ?? ''

if (!title.trim()) {
  console.error('::error::No PR title to check.')
  process.exit(1)
}

const verdict = validateCommitTitle(title)

if (!verdict.ok) {
  console.error(`::error::${verdict.error}`)
  console.error(`  title: ${title}`)
  process.exit(1)
}

console.log(`ok: ${title}`)
