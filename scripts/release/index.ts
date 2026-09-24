// The app release track's IO half. Every decision comes from the pure modules
// beside it; this file reads git, writes the manifest and changelog, and talks
// to `gh`.
//
//   plan     read-only: what would the next release be?
//   prepare  write package.json + CHANGELOG.md and fold changelog.d/ (no git)
//   publish  create the GitHub Release for the tagged commit (CI runs this)
//
// The branch, the commit, the PR and the tag belong to whoever runs the release
// — the maintainer's release tool, or a person following RELEASING.md. The
// `Release · publish` workflow runs `publish` when a `vX.Y.Z` tag is pushed,
// which is the same split the CLI track (`cliRelease.ts`) uses.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withoutReleaseCommits } from './conventional.ts'
import {
  addSummary,
  commitsSince,
  createGithubRelease,
  flag,
  gitQuiet,
  githubReleaseExists,
  ReleaseError,
  ROOT,
  repoUrl,
  requireTaggedHead,
  setOutput,
  untaggedRelease,
} from './io.ts'
import {
  extractRelease,
  insertRelease,
  releaseIndex,
  renderReleaseNotes,
  splitChangelog,
} from './notes.ts'
import type { Fragment } from './notes.ts'
import { planRelease, summariseCounts } from './plan.ts'
import type { ReleasePlan } from './plan.ts'
import { highestVersion, parseSemVer, toTag, validateNextVersion } from './semver.ts'

const CHANGELOG = join(ROOT, 'CHANGELOG.md')
const FRAGMENTS = join(ROOT, 'changelog.d')
const PACKAGE = join(ROOT, 'package.json')

function manifestVersion(): string {
  const manifest = JSON.parse(readFileSync(PACKAGE, 'utf8')) as { version?: string }
  if (!manifest.version) throw new ReleaseError('package.json has no "version" field.')
  return manifest.version
}

/** Newest `vX.Y.Z` tag, or null before the first release. */
function latestTag(): string | null {
  const tags = gitQuiet('tag', '--list', 'v*').split('\n').filter(Boolean)
  const highest = highestVersion(tags)
  return highest ? toTag(highest) : null
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
  /** Version the range starts from: the newest tag, or the manifest before the first one. */
  current: string
  previousTag: string | null
  commits: { sha: string; subject: string }[]
  fragments: Fragment[]
}

function resolve(options: { allowMajor?: boolean } = {}): Resolved {
  const previousTag = latestTag()
  // Before the first tag the manifest version *is* the release; after it, the
  // newest tag is the base so a hand-edited manifest can never skew the bump.
  const current = previousTag?.replace(/^v/, '') ?? manifestVersion()
  const commits = withoutReleaseCommits(commitsSince(previousTag))
  const plan = planRelease({
    currentVersion: current,
    commits,
    allowMajor: options.allowMajor ?? false,
    firstRelease: previousTag === null,
  })
  return { plan, current, previousTag, commits, fragments: readFragments() }
}

function describe({ plan, previousTag, fragments }: Resolved, pending: string | null): string {
  const lines = [
    `Current:  ${previousTag ?? `${plan.current} (no tags yet)`}`,
    `Range:    ${previousTag ? `${previousTag}..HEAD` : 'HEAD (full history)'}`,
    `Commits:  ${plan.total}${plan.total ? ` — ${summariseCounts(plan.counts)}` : ''}`,
  ]
  if (plan.breaking.length > 0) lines.push(`Breaking: ${plan.breaking.length}`)
  if (plan.unconventional.length > 0) {
    lines.push(`Unknown:  ${plan.unconventional.length} commit(s) with a non-conventional subject`)
  }
  lines.push(`Fragments: ${fragments.length} in changelog.d/`, '')
  if (pending) {
    lines.push(`Pending:  ${pending} is merged but not tagged — tag it first.`)
    return lines.join('\n')
  }
  lines.push(
    plan.releasable ? `Next:     ${plan.tag}  (${plan.reason})` : `No release: ${plan.reason}`,
  )
  return lines.join('\n')
}

function commandPlan(argv: string[]): number {
  const resolved = resolve({ allowMajor: argv.includes('--allow-major') })
  const { plan, current, previousTag, commits } = resolved
  const pending = untaggedRelease(toTag(manifestVersion()))

  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          package: null,
          tagPrefix: 'v',
          current,
          previousTag,
          next: plan.next,
          tag: plan.tag,
          bump: plan.bump,
          releasable: plan.releasable,
          reason: plan.reason,
          pending,
          commits: commits.map(({ sha, subject }) => ({ sha, subject })),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(describe(resolved, pending?.tag ?? null))
  }

  setOutput('releasable', String(plan.releasable))
  setOutput('version', plan.next ?? '')
  setOutput('tag', plan.tag ?? '')
  setOutput('reason', plan.reason)
  // `--check` makes "nothing to release" a non-zero exit for shell callers.
  return argv.includes('--check') && !plan.releasable ? 1 : 0
}

// --------------------------------------------------------------------- prepare

type NotesSource = 'both' | 'fragments' | 'unreleased'

/**
 * Which prose source feeds the release notes. `both` is right once
 * `## Unreleased` is empty and fragments are the only inflow; pick one when the
 * same work is tracked in both places, so no entry prints twice.
 */
function notesSource(argv: string[]): NotesSource {
  const value = flag(argv, 'notes-from') ?? 'both'
  if (value !== 'both' && value !== 'fragments' && value !== 'unreleased') {
    throw new ReleaseError(`--notes-from must be both, fragments or unreleased; got "${value}".`)
  }
  return value
}

/**
 * Writes the release into the working tree and nothing else — the caller owns
 * the branch, the commit and the PR, so a dry run and a real run differ only in
 * whether these files change.
 */
function commandPrepare(argv: string[]): number {
  const resolved = resolve({ allowMajor: argv.includes('--allow-major') })
  const { plan, current, previousTag } = resolved
  console.log(describe(resolved, null))

  const version = flag(argv, 'version')?.replace(/^v/, '') ?? plan.next
  if (!version) {
    throw new ReleaseError(`Nothing to release (${plan.reason}). Pass --version= to force one.`)
  }
  const invalid = validateNextVersion(version, current, previousTag !== null)
  if (invalid) throw new ReleaseError(invalid)
  const tag = toTag(version)
  if (gitQuiet('tag', '--list', tag)) throw new ReleaseError(`${tag} already exists.`)

  const source = notesSource(argv)
  const { carried } = splitChangelog(readFileSync(CHANGELOG, 'utf8'))
  const notes = renderReleaseNotes({
    plan: { ...plan, next: version, tag },
    fragments: source === 'unreleased' ? [] : resolved.fragments,
    carried: source === 'fragments' ? [] : carried,
    repoUrl: repoUrl(),
    previousTag,
  })

  if (argv.includes('--dry-run')) {
    console.log(`\n--- CHANGELOG.md would gain ---\n\n${notes}`)
    setOutput('prepared', 'false')
    return 0
  }

  const manifest = readFileSync(PACKAGE, 'utf8')
  const field = /^(\s*"version":\s*)"[^"]*"/m
  // A string edit rather than a JSON round-trip, so key order and formatting survive.
  writeFileSync(PACKAGE, manifest.replace(field, `$1"${version}"`))
  writeFileSync(CHANGELOG, insertRelease(readFileSync(CHANGELOG, 'utf8'), notes))
  for (const fragment of readFragments()) rmSync(join(FRAGMENTS, fragment.name))
  // Keep the directory in git so the next contributor still has somewhere to write.
  writeFileSync(join(FRAGMENTS, '.gitkeep'), '')

  console.log(`\nPrepared ${tag}: package.json, CHANGELOG.md, changelog.d/`)
  setOutput('prepared', 'true')
  setOutput('version', version)
  setOutput('tag', tag)
  return 0
}

// --------------------------------------------------------------------- publish

function commandPublish(argv: string[]): number {
  const version = manifestVersion()
  const tag = toTag(version)
  const expected = flag(argv, 'expect')
  if (expected && expected !== tag) {
    throw new ReleaseError(`Expected ${expected}, but package.json identifies ${tag}.`)
  }
  requireTaggedHead(tag)

  const notes = extractRelease(readFileSync(CHANGELOG, 'utf8'), version)
  if (!notes) throw new ReleaseError(`CHANGELOG.md has no "## v${version}" section to publish.`)

  if (githubReleaseExists(tag)) {
    console.log(`The ${tag} GitHub Release already exists.`)
    setOutput('published', 'false')
    return 0
  }
  if (argv.includes('--dry-run')) {
    console.log(`Would create GitHub Release ${tag}:\n\n${releaseIndex(notes)}`)
    setOutput('published', 'false')
    return 0
  }

  const prerelease = parseSemVer(version)?.prerelease ? ['--prerelease'] : []
  createGithubRelease(tag, `Open Run ${tag}`, releaseIndex(notes), prerelease)
  if (!githubReleaseExists(tag)) throw new ReleaseError(`gh did not create the ${tag} Release.`)

  console.log(`Published ${tag}.`)
  addSummary(`### Published ${tag}\n\n${notes}`)
  setOutput('published', 'true')
  setOutput('tag', tag)
  return 0
}

// ----------------------------------------------------------------------- main

const USAGE = `Usage: pnpm release:<command>

  plan     [--json] [--check] [--allow-major]   What the next release would be
  prepare  [--version=X.Y.Z] [--dry-run]        Write the version, changelog and
           [--notes-from=both|fragments|unreleased]  fold changelog.d/ (no git)
           [--allow-major]
  publish  [--dry-run] [--expect=vX.Y.Z]        Create the GitHub Release for the
                                                tagged commit
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
