// `pnpm ship "feat(scope): summary"` — branch, commit, push, open the PR.
//
// The one primitive both a human and an unattended agent use, so that "never
// commit on main" is something the tooling enforces rather than something the
// contributor has to remember. An agent that starts on main gets moved onto a
// branch instead of being trusted to do it.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCommit, validateCommitTitle } from './release/conventional.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(ROOT, '.github', 'pull_request_template.md')

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim()

const git = (...args: string[]) => run('git', args)

function fail(message: string): never {
  console.error(`\nship: ${message}`)
  process.exit(1)
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const draft = argv.includes('--draft')
const title = argv.find((arg) => !arg.startsWith('--')) ?? ''

if (!title) {
  fail('Usage: pnpm ship "feat(scope): summary" [--draft] [--dry-run]')
}

const verdict = validateCommitTitle(title)
// Checked here rather than after the push, so a bad title costs nothing.
if (!verdict.ok) fail(`${verdict.error}\n  title: ${title}`)

/** `feat/add-bulk-delete` — the type, then a slug of the subject. */
function branchName(commitTitle: string): string {
  const parsed = parseCommit({ sha: '', subject: commitTitle })
  const slug = parsed.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
  return `${parsed.type}/${slug}`
}

const current = git('rev-parse', '--abbrev-ref', 'HEAD')
const branch = current === 'main' ? branchName(title) : current

if (!git('status', '--porcelain')) fail('Nothing to ship — the working tree is clean.')

if (dryRun) {
  console.log(`branch: ${branch}${current === 'main' ? ' (new, from main)' : ' (current)'}`)
  console.log(`commit: ${title}`)
  console.log('files:')
  console.log(git('status', '--short'))
  process.exit(0)
}

if (current === 'main') {
  console.log(`→ Branching off main: ${branch}`)
  git('checkout', '-b', branch)
}

git('add', '-A')
git('commit', '-m', title)
git('push', '-u', 'origin', branch)

const existing = run('gh', ['pr', 'list', '--head', branch, '--json', 'url', '--jq', '.[0].url'])
if (existing) {
  console.log(`\nPushed to the open PR: ${existing}`)
  process.exit(0)
}

// Start from the repo's own template so the three required sections are present
// and a reviewer sees the shape they expect.
const body = existsSync(TEMPLATE)
  ? readFileSync(TEMPLATE, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  : '## Summary\n\n-\n\n## Test plan\n\n- [ ]'

const args = ['pr', 'create', '--title', title, '--body', body, '--base', 'main', '--head', branch]
if (draft) args.push('--draft')

console.log(`\n${run('gh', args)}`)
