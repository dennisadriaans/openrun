// The CLI release track's IO half. Every decision comes from `cli.ts`; this
// file reads git, writes the CLI manifest and changelog, and talks to npm/gh.
//
//   plan     read-only: which commits reach the npm package, and what's next?
//   prepare  write apps/cli/package.json + apps/cli/CHANGELOG.md (no git)
//   publish  build, smoke-test and publish the tagged commit to npm, then the
//            GitHub Release — each step skipped when it already happened
//
// Tagging stays with whoever merged the release PR (the private release tool,
// or a maintainer), exactly like the app. `publish` refuses to run anywhere but
// on the tagged commit, so npm only ever receives a version git can reproduce.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  cliBaseline,
  cliCommits,
  cliTag,
  type CliBaseline,
  type CliReleaseConfig,
  npmDistTag,
  planCliRelease,
  readCliReleaseConfig,
  renderCliNotes,
  validateCliVersion,
} from './cli.ts'
import { addSummary, git, gitQuiet, ReleaseError, ROOT, run, runLive, setOutput } from './io.ts'
import { extractRelease, insertRelease } from './notes.ts'
import type { ReleasePlan } from './plan.ts'
import { summariseCounts } from './plan.ts'

const CLI_MANIFEST = join(ROOT, 'apps/cli/package.json')
const CLI_CHANGELOG = join(ROOT, 'apps/cli/CHANGELOG.md')
const NPM_DIR = join(ROOT, 'dist/npm')

type CliManifest = { version?: string; release?: unknown }

function readCliManifest(): { version: string; config: CliReleaseConfig } {
  const manifest = JSON.parse(readFileSync(CLI_MANIFEST, 'utf8')) as CliManifest
  if (!manifest.version) throw new ReleaseError('apps/cli/package.json has no "version" field.')
  return { version: manifest.version, config: readCliReleaseConfig(manifest) }
}

function repoUrl(): string | undefined {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    repository?: { url?: string }
  }
  return manifest.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '')
}

function flag(argv: string[], name: string): string | undefined {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
}

// -------------------------------------------------------------------- planning

type Resolved = {
  config: CliReleaseConfig
  manifestVersion: string
  baseline: CliBaseline
  commits: { sha: string; subject: string; body: string }[]
  plan: ReleasePlan
}

/** Commits in `baseline..HEAD` that touch a path the npm package is built from. */
function cliRangeCommits(config: CliReleaseConfig, baseline: CliBaseline) {
  const range = baseline.tag ? `${baseline.tag}..HEAD` : 'HEAD'
  const raw = gitQuiet(
    'log',
    range,
    '--no-merges',
    '--format=%H%x1f%s%x1f%b%x1e',
    '--',
    ...config.paths,
  )
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

function resolve(options: { allowMajor?: boolean } = {}): Resolved {
  const { version, config } = readCliManifest()
  const tags = gitQuiet('tag', '--list').split('\n').filter(Boolean)
  const baseline = cliBaseline({ config, tags, manifestVersion: version })
  const commits = cliCommits(cliRangeCommits(config, baseline))
  const plan = planCliRelease({ config, baseline, commits, allowMajor: options.allowMajor })
  return { config, manifestVersion: version, baseline, commits, plan }
}

function describe({ config, baseline, plan }: Resolved): string {
  const lines = [
    `Package:  ${config.package}`,
    `Current:  ${baseline.version}${baseline.tag ? ` (${baseline.tag}${baseline.legacy ? ', shared app tag' : ''})` : ' (never published)'}`,
    `Range:    ${baseline.tag ? `${baseline.tag}..HEAD` : 'HEAD (full history)'} — CLI paths only`,
    `Commits:  ${plan.total}${plan.total ? ` — ${summariseCounts(plan.counts)}` : ''}`,
  ]
  if (plan.breaking.length > 0) lines.push(`Breaking: ${plan.breaking.length}`)
  lines.push('')
  lines.push(
    plan.releasable ? `Next:     ${plan.tag}  (${plan.reason})` : `No release: ${plan.reason}`,
  )
  return lines.join('\n')
}

function commandPlan(argv: string[]): number {
  const resolved = resolve({ allowMajor: argv.includes('--allow-major') })
  const { config, baseline, plan, commits } = resolved

  if (argv.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          package: config.package,
          tagPrefix: config.tagPrefix,
          manifestVersion: resolved.manifestVersion,
          current: baseline.version,
          previousTag: baseline.tag,
          legacyBaseline: baseline.legacy,
          next: plan.next,
          tag: plan.tag,
          bump: plan.bump,
          releasable: plan.releasable,
          reason: plan.reason,
          total: plan.total,
          counts: plan.counts,
          commits: commits.map(({ sha, subject }) => ({ sha, subject })),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(describe(resolved))
  }

  setOutput('releasable', String(plan.releasable))
  setOutput('version', plan.next ?? '')
  setOutput('tag', plan.tag ?? '')
  setOutput('reason', plan.reason)
  return argv.includes('--check') && !plan.releasable ? 1 : 0
}

// --------------------------------------------------------------------- prepare

/**
 * Writes the release into the working tree and nothing else — the caller owns
 * the branch, the commit and the PR, so a dry run and a real run differ only in
 * whether these two files change.
 */
function commandPrepare(argv: string[]): number {
  const resolved = resolve({ allowMajor: argv.includes('--allow-major') })
  const { config, baseline, plan } = resolved
  console.log(describe(resolved))

  const version = flag(argv, 'version')?.replace(/^v/, '') ?? plan.next
  if (!version) {
    throw new ReleaseError(`Nothing to release (${plan.reason}). Pass --version= to force one.`)
  }
  const invalid = validateCliVersion(version, baseline)
  if (invalid) throw new ReleaseError(invalid)
  const tag = cliTag(config, version)
  if (gitQuiet('tag', '--list', tag)) throw new ReleaseError(`${tag} already exists.`)

  const notesFile = flag(argv, 'notes-file')
  const summary = notesFile ? readFileSync(notesFile, 'utf8') : undefined
  const notes = renderCliNotes({ config, plan, version, baseline, summary, repoUrl: repoUrl() })

  if (argv.includes('--dry-run')) {
    console.log(`\n--- apps/cli/CHANGELOG.md would gain ---\n\n${notes}`)
    setOutput('prepared', 'false')
    return 0
  }

  const manifest = readFileSync(CLI_MANIFEST, 'utf8')
  const field = /^(\s*"version":\s*)"[^"]*"/m
  // A string edit rather than a JSON round-trip, so key order and formatting survive.
  writeFileSync(CLI_MANIFEST, manifest.replace(field, `$1"${version}"`))
  writeFileSync(CLI_CHANGELOG, insertRelease(readFileSync(CLI_CHANGELOG, 'utf8'), notes))

  console.log(`\nPrepared ${tag}: apps/cli/package.json, apps/cli/CHANGELOG.md`)
  setOutput('prepared', 'true')
  setOutput('version', version)
  setOutput('tag', tag)
  return 0
}

// --------------------------------------------------------------------- publish

function npmHas(pkg: string, version: string): boolean {
  return run('npm', ['view', `${pkg}@${version}`, 'version'], { allowFailure: true }) === version
}

async function waitForNpm(pkg: string, version: string): Promise<boolean> {
  // The registry's read side lags the write by a few seconds.
  for (let attempt = 0; attempt < 12; attempt++) {
    if (npmHas(pkg, version)) return true
    await new Promise((settle) => setTimeout(settle, 5_000))
  }
  return false
}

/** `npm pack` into `dist/`, returning the tarball's path. */
function pack(spec: string): string {
  const packed = JSON.parse(
    run('npm', ['pack', spec, '--json', '--pack-destination', join(ROOT, 'dist')]),
  ) as { filename: string }[]
  const filename = packed[0]?.filename
  if (!filename) throw new ReleaseError(`npm pack ${spec} produced no tarball.`)
  // Scoped names pack as `scope-name-x.y.z.tgz`; npm reports the bare file name.
  return join(ROOT, 'dist', filename.split('/').pop()!)
}

async function commandPublish(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run')
  const { version, config } = readCliManifest()
  const tag = cliTag(config, version)

  const expected = flag(argv, 'expect')
  if (expected && expected !== tag) {
    throw new ReleaseError(`Expected ${expected}, but apps/cli/package.json identifies ${tag}.`)
  }

  // Only a tagged commit is publishable: npm versions are immutable, so the
  // bytes behind one must be rebuildable from a ref nobody moves.
  const tagged = gitQuiet('rev-parse', `${tag}^{commit}`)
  const head = git('rev-parse', 'HEAD')
  if (!tagged) throw new ReleaseError(`${tag} does not exist. Tag the merged release commit first.`)
  if (tagged !== head) {
    throw new ReleaseError(`${tag} is ${tagged.slice(0, 9)}, but HEAD is ${head.slice(0, 9)}.`)
  }

  const notes = extractRelease(
    existsSync(CLI_CHANGELOG) ? readFileSync(CLI_CHANGELOG, 'utf8') : '',
    version,
  )
  if (!notes) throw new ReleaseError(`apps/cli/CHANGELOG.md has no "## v${version}" section.`)

  const onNpm = npmHas(config.package, version)
  const releaseExists = Boolean(
    run('gh', ['release', 'view', tag, '--json', 'tagName'], { allowFailure: true }),
  )
  if (onNpm && releaseExists) {
    console.log(`${config.package}@${version} and the ${tag} GitHub Release already exist.`)
    setOutput('published', 'false')
    setOutput('tag', tag)
    return 0
  }

  const distTag = npmDistTag(version)
  if (dryRun) {
    if (!onNpm) console.log(`Would publish ${config.package}@${version} (dist-tag ${distTag}).`)
    if (!releaseExists) console.log(`Would create GitHub Release ${tag}:\n\n${notes}`)
    setOutput('published', 'false')
    return 0
  }

  let tarball: string
  if (onNpm) {
    // Attach the bytes npm already serves rather than a rebuild of them.
    console.log(`${config.package}@${version} is already on npm; not publishing again.`)
    tarball = pack(`${config.package}@${version}`)
  } else {
    runLive('pnpm', ['cli:package'])
    runLive('pnpm', ['cli:smoke'])
    tarball = pack(NPM_DIR)
  }
  try {
    if (!onNpm) {
      const args = ['publish', tarball, '--access', 'public', '--tag', distTag]
      // Provenance links the package to this workflow run; it needs an OIDC token.
      if (process.env.GITHUB_ACTIONS === 'true') args.push('--provenance')
      runLive('npm', args)
      if (!(await waitForNpm(config.package, version))) {
        throw new ReleaseError(`npm accepted ${version} but the registry does not list it yet.`)
      }
      console.log(`Published ${config.package}@${version} (${distTag}).`)
    }

    if (!releaseExists) {
      const notesFile = join(ROOT, '.cli-release-notes.md')
      writeFileSync(
        notesFile,
        `${notes}\n\nInstall: \`npm install -g ${config.package}@${version}\`\n`,
      )
      try {
        const args = [
          'release',
          'create',
          tag,
          tarball,
          '--verify-tag',
          '--title',
          `Open Run CLI ${tag}`,
          '--notes-file',
          notesFile,
          // The app's release is the repository's headline; a CLI patch must not replace it.
          '--latest=false',
        ]
        if (distTag === 'next') args.push('--prerelease')
        run('gh', args)
      } finally {
        rmSync(notesFile, { force: true })
      }
    }
  } finally {
    rmSync(tarball, { force: true })
  }

  console.log(`Published and verified ${tag}.`)
  addSummary(`### Published ${config.package}@${version}\n\n${notes}`)
  setOutput('published', 'true')
  setOutput('tag', tag)
  setOutput('version', version)
  return 0
}

// ----------------------------------------------------------------------- main

const USAGE = `Usage: pnpm release:cli:<command>

  plan     [--json] [--check] [--allow-major]      What the next CLI release would be
  prepare  [--version=X.Y.Z] [--notes-file=PATH]   Write the version and CLI changelog
           [--dry-run] [--allow-major]
  publish  [--dry-run] [--expect=cli-vX.Y.Z]       Publish the tagged commit to npm
                                                   and create its GitHub Release
`

async function main(): Promise<number> {
  const [command = '', ...argv] = process.argv.slice(2)
  switch (command) {
    case 'plan':
      return commandPlan(argv)
    case 'prepare':
      return commandPrepare(argv)
    case 'publish':
      return await commandPublish(argv)
    default:
      console.error(USAGE)
      return command ? 1 : 0
  }
}

try {
  process.exit(await main())
} catch (error) {
  if (error instanceof ReleaseError) {
    console.error(`\nrelease:cli: ${error.message}`)
    process.exit(1)
  }
  throw error
}
