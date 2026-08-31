// The release pipeline's IO half. Every decision it makes comes from
// `scripts/release/*`, which is pure and tested; this file only reads git,
// writes files and talks to `gh`.
//
//   plan     read-only: what would the next release be?
//   prepare  write the version, changelog and release branch
//   publish  tag the merged commit and create the GitHub Release
//
// `prepare` and `publish` are deliberately separate operations: preparing opens
// a PR whose parent SHA freezes the release contents, and publishing runs in CI
// against that exact tested commit. A laptop is never the release authority.

import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseCadence, isReleaseDue } from './cadence.ts'
import { extractRelease, insertRelease, renderReleaseNotes, splitChangelog } from './notes.ts'
import type { Fragment } from './notes.ts'
import { planRelease, summariseCounts } from './plan.ts'
import type { ReleasePlan } from './plan.ts'
import { highestVersion, toTag } from './semver.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const FRAGMENTS = join(ROOT, 'changelog.d')
const PACKAGE = join(ROOT, 'package.json')

class ReleaseError extends Error {}

// ---------------------------------------------------------------- process IO

function run(command: string, args: string[], options: { allowFailure?: boolean } = {}): string {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    if (options.allowFailure) return ''
    const detail = error instanceof Error ? error.message : String(error)
    throw new ReleaseError(`\`${command} ${args.join(' ')}\` failed:\n${detail}`)
  }
}

const git = (...args: string[]) => run('git', args)
const gitQuiet = (...args: string[]) => run('git', args, { allowFailure: true })

/** Streams a command's output rather than capturing it, for the verify gates. */
function runLive(command: string, args: string[]): void {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' })
}

// ------------------------------------------------------------------ repo state

type Manifest = { version?: string; repository?: { url?: string }; release?: unknown }

const readManifest = (): Manifest => JSON.parse(readFileSync(PACKAGE, 'utf8')) as Manifest

/** `https://github.com/owner/repo`, normalised from the package manifest. */
function repoUrl(manifest: Manifest): string | undefined {
  const url = manifest.repository?.url
  if (!url) return undefined
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

/** Newest `vX.Y.Z` tag, or null before the first release. */
function latestTag(): string | null {
  const tags = gitQuiet('tag', '--list', 'v*').split('\n').filter(Boolean)
  const highest = highestVersion(tags)
  return highest ? toTag(highest) : null
}

function tagExists(tag: string): boolean {
  return gitQuiet('tag', '--list', tag) === tag
}

/** Whether a branch already exists on `origin`, without needing it fetched. */
function remoteBranchExists(branch: string): boolean {
  return gitQuiet('ls-remote', '--heads', 'origin', branch).includes(`refs/heads/${branch}`)
}

type RangeCommit = { sha: string; subject: string; body: string }

/** Commits in `tag..HEAD`, or the whole history before the first release. */
function commitsSince(tag: string | null): RangeCommit[] {
  const range = tag ? `${tag}..HEAD` : 'HEAD'
  // Record and unit separators keep multi-line bodies unambiguous.
  const raw = gitQuiet('log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e')
  if (!raw) return []

  return raw
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.split('\x1f')
      return { sha: sha.trim(), subject: subject.trim(), body }
    })
}

function readFragments(): Fragment[] {
  if (!existsSync(FRAGMENTS)) return []
  return readdirSync(FRAGMENTS)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, body: readFileSync(join(FRAGMENTS, name), 'utf8') }))
    .filter((fragment) => fragment.body.trim())
}

// -------------------------------------------------------------------- planning

type Resolved = {
  plan: ReleasePlan
  manifest: Manifest
  previousTag: string | null
  fragments: Fragment[]
  firstRelease: boolean
}

function resolvePlan(options: { allowMajor?: boolean } = {}): Resolved {
  const manifest = readManifest()
  if (!manifest.version) {
    throw new ReleaseError('package.json has no "version" field — the release pipeline needs one.')
  }

  const previousTag = latestTag()
  const firstRelease = previousTag === null
  // Before the first tag the manifest version *is* the release; after it, the
  // newest tag is the base so a hand-edited manifest can never skew the bump.
  const currentVersion = previousTag ?? manifest.version

  const plan = planRelease({
    currentVersion,
    commits: commitsSince(previousTag),
    allowMajor: options.allowMajor ?? false,
    firstRelease,
  })

  return { plan, manifest, previousTag, fragments: readFragments(), firstRelease }
}

// --------------------------------------------------------------- GH plumbing

/** Sets a GitHub Actions step output when running in CI; a no-op locally. */
function setOutput(key: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return
  // A multi-line value needs a heredoc with a delimiter the value cannot contain.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`
  appendFileSync(file, `${key}<<${delimiter}\n${value}\n${delimiter}\n`)
}

function addSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, `${markdown}\n`)
}

// ------------------------------------------------------------------- commands

function describePlan(resolved: Resolved): string {
  const { plan, previousTag } = resolved
  const lines = [
    `Current:  ${previousTag ?? `${plan.current} (no tags yet)`}`,
    `Range:    ${previousTag ? `${previousTag}..HEAD` : 'HEAD (full history)'}`,
    `Commits:  ${plan.total}${plan.total ? ` — ${summariseCounts(plan.counts)}` : ''}`,
  ]

  if (plan.breaking.length > 0) lines.push(`Breaking: ${plan.breaking.length}`)
  if (plan.unconventional.length > 0) {
    lines.push(`Unknown:  ${plan.unconventional.length} commit(s) with a non-conventional subject`)
  }
  lines.push(`Fragments: ${resolved.fragments.length} in changelog.d/`)
  lines.push('')
  lines.push(
    plan.releasable ? `Next:     ${plan.tag}  (${plan.reason})` : `No release: ${plan.reason}`,
  )

  return lines.join('\n')
}

function commandPlan(argv: string[]): number {
  const resolved = resolvePlan({ allowMajor: argv.includes('--allow-major') })

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...resolved.plan, previousTag: resolved.previousTag }, null, 2))
  } else {
    console.log(describePlan(resolved))
  }

  setOutput('releasable', String(resolved.plan.releasable))
  setOutput('version', resolved.plan.next ?? '')
  setOutput('tag', resolved.plan.tag ?? '')
  setOutput('reason', resolved.plan.reason)

  // `--check` makes "nothing to release" a non-zero exit for shell callers.
  return argv.includes('--check') && !resolved.plan.releasable ? 1 : 0
}

function verify(): void {
  console.log('\n→ Verifying (lint · typecheck · test · build)\n')
  runLive('pnpm', ['exec', 'biome', 'ci', 'src', 'scripts'])
  runLive('pnpm', ['typecheck'])
  runLive('pnpm', ['test'])
  runLive('pnpm', ['build'])
}

function commandPrepare(argv: string[]): number {
  const dryRun = argv.includes('--dry-run')

  // Cadence is checked before anything else so a non-release day costs one
  // `git` call and nothing more.
  if (argv.includes('--respect-cadence')) {
    const verdict = isReleaseDue(parseCadence(readManifest().release))
    if (!verdict.due) {
      console.log(verdict.reason)
      addSummary(`### No release\n\n${verdict.reason}`)
      setOutput('prepared', 'false')
      setOutput('reason', verdict.reason)
      return 0
    }
    console.log(verdict.reason)
  }

  const resolved = resolvePlan({ allowMajor: argv.includes('--allow-major') })
  const { plan, manifest } = resolved
  console.log(describePlan(resolved))

  if (!plan.releasable || !plan.next || !plan.tag) {
    addSummary(`### No release\n\n${plan.reason}`)
    setOutput('prepared', 'false')
    setOutput('reason', plan.reason)
    return 0
  }

  // Idempotency: a rerun after a partial failure must never build a second,
  // different release under a version that already shipped.
  if (tagExists(plan.tag)) {
    throw new ReleaseError(
      `${plan.tag} already exists. The range moved but the version did not — ` +
        'delete the stale tag or land another commit before preparing again.',
    )
  }

  // The cadence window stays open for the rest of the release day, so a later
  // scheduled run would otherwise prepare the same version a second time.
  const branch = `release/${plan.tag}`
  if (remoteBranchExists(branch)) {
    const message = `${branch} is already open — ${plan.tag} is prepared and waiting to merge.`
    console.log(message)
    addSummary(`### No release\n\n${message}`)
    setOutput('prepared', 'false')
    setOutput('reason', message)
    return 0
  }

  if (!argv.includes('--skip-verify')) verify()

  const source = notesSource(argv)
  // Bullets under `## Unreleased` and `changelog.d/` fragments often describe the
  // same work, so the source is explicit rather than blindly concatenated.
  const { carried } = splitChangelog(readFileSync(CHANGELOG, 'utf8'))
  const notes = renderReleaseNotes({
    plan,
    fragments: source === 'unreleased' ? [] : resolved.fragments,
    carried: source === 'fragments' ? [] : carried,
    repoUrl: repoUrl(manifest),
    previousTag: resolved.previousTag,
  })

  if (dryRun) {
    console.log(`\n--- ${branch} would contain ---\n`)
    console.log(notes)
    setOutput('prepared', 'false')
    return 0
  }

  writeRelease(plan.next, notes)

  git('checkout', '-B', branch)
  git('add', 'package.json', 'CHANGELOG.md', 'changelog.d')
  git('commit', '-m', `chore(release): ${plan.tag}`)

  console.log(`\nPrepared ${plan.tag} on ${branch}.`)
  addSummary(
    `### Prepared ${plan.tag}\n\n${plan.reason}\n\n<details><summary>Release notes</summary>\n\n${notes}\n</details>`,
  )

  setOutput('prepared', 'true')
  setOutput('version', plan.next)
  setOutput('tag', plan.tag)
  setOutput('branch', branch)
  setOutput('notes', notes)
  setOutput('reason', plan.reason)
  return 0
}

type NotesSource = 'both' | 'fragments' | 'unreleased'

/**
 * Which prose source feeds the release notes.
 *
 * `both` is right once `## Unreleased` is empty and fragments are the only
 * inflow; a first release that has been tracking the same work in both places
 * picks one to avoid printing every entry twice.
 */
function notesSource(argv: string[]): NotesSource {
  const flag = argv.find((arg) => arg.startsWith('--notes-from='))?.split('=')[1] ?? 'both'
  if (flag !== 'both' && flag !== 'fragments' && flag !== 'unreleased') {
    throw new ReleaseError(`--notes-from must be both, fragments or unreleased; got "${flag}".`)
  }
  return flag
}

/** Writes the version, folds the changelog, and consumes the fragments. */
function writeRelease(version: string, notes: string): void {
  const source = readFileSync(PACKAGE, 'utf8')
  const field = /^(\s*"version":\s*)"[^"]*"/m
  // Test for the field rather than for a changed string: a first release
  // publishes the version already in the manifest, and that no-op is legitimate.
  if (!field.test(source)) throw new ReleaseError('package.json has no "version" field to rewrite.')
  // A string edit rather than a JSON round-trip, so key order and formatting survive.
  writeFileSync(PACKAGE, source.replace(field, `$1"${version}"`))

  const changelog = readFileSync(CHANGELOG, 'utf8')
  writeFileSync(CHANGELOG, insertRelease(changelog, notes))

  for (const fragment of readFragments()) rmSync(join(FRAGMENTS, fragment.name))
  // Keep the directory in git so the next contributor still has somewhere to write.
  writeFileSync(join(FRAGMENTS, '.gitkeep'), '')
}

function commandPublish(argv: string[]): number {
  const dryRun = argv.includes('--dry-run')
  const manifest = readManifest()
  const version = manifest.version
  if (!version) throw new ReleaseError('package.json has no "version" field.')

  const tag = toTag(version)

  // Idempotency: publishing twice is a no-op, never a second artifact under
  // the same version.
  if (tagExists(tag)) {
    console.log(`${tag} already exists — nothing to publish.`)
    setOutput('published', 'false')
    setOutput('tag', tag)
    return 0
  }

  const subject = git('log', '-1', '--format=%s')
  if (subject !== `chore(release): ${tag}`) {
    console.log(`HEAD is "${subject}", not the release commit for ${tag} — nothing to publish.`)
    setOutput('published', 'false')
    return 0
  }

  const notes = extractRelease(readFileSync(CHANGELOG, 'utf8'), version)
  if (!notes) throw new ReleaseError(`CHANGELOG.md has no "## v${version}" section to publish.`)

  if (dryRun) {
    console.log(`Would tag ${tag} at ${git('rev-parse', 'HEAD')} with:\n\n${notes}`)
    setOutput('published', 'false')
    return 0
  }

  git('tag', '-a', tag, '-m', `Open Run ${tag}`)
  git('push', 'origin', tag)

  const notesFile = join(ROOT, '.release-notes.md')
  writeFileSync(notesFile, notes)
  try {
    run('gh', ['release', 'create', tag, '--title', `Open Run ${tag}`, '--notes-file', notesFile])
  } finally {
    rmSync(notesFile, { force: true })
  }

  console.log(`Published ${tag}.`)
  addSummary(`### Published ${tag}\n\n${notes}`)
  setOutput('published', 'true')
  setOutput('tag', tag)
  setOutput('version', version)
  return 0
}

// ----------------------------------------------------------------------- main

const USAGE = `Usage: pnpm release:<command>

  plan     [--json] [--check] [--allow-major]   What the next release would be
  prepare  [--dry-run] [--skip-verify]          Write the release onto release/vX.Y.Z
           [--respect-cadence] [--allow-major]
           [--notes-from=both|fragments|unreleased]
  publish  [--dry-run]                          Tag HEAD and create the GitHub Release
`

function main(): number {
  const [command = '', ...argv] = process.argv.slice(2)

  switch (command) {
    case 'plan':
      return commandPlan(argv)
    case 'prepare':
      return commandPrepare(argv)
    case 'publish':
      return commandPublish(argv)
    default:
      console.error(USAGE)
      return command ? 1 : 0
  }
}

try {
  process.exit(main())
} catch (error) {
  if (error instanceof ReleaseError) {
    console.error(`\nrelease: ${error.message}`)
    process.exit(1)
  }
  throw error
}
