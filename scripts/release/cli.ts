/**
 * The CLI's own release track.
 *
 * The npm package (`@dennisadriaans/openrun`) ships on its own cadence: its
 * version lives in `apps/cli/package.json`, its tags are `cli-vX.Y.Z`, and its
 * notes go to `apps/cli/CHANGELOG.md`. The app's `vX.Y.Z` tags and root
 * `package.json` version are never consulted after the first CLI tag exists.
 *
 * Everything that decides *what* ships — which commits count, the baseline, the
 * next version, the notes — is here and pure. `cliRelease.ts` does the IO, and
 * the maintainer's release tool drives that script rather than re-deriving any of it.
 */

import { withoutReleaseCommits } from './conventional.ts'
import type { CommitInput } from './conventional.ts'
import { renderReleaseNotes } from './notes.ts'
import { planRelease } from './plan.ts'
import type { ReleasePlan } from './plan.ts'
import { compareSemVer, formatSemVer, parseSemVer, toTag } from './semver.ts'

/** The `release` field of `apps/cli/package.json`. */
export type CliReleaseConfig = {
  /** npm package name the generated `dist/npm` is published under. */
  package: string
  /** Tag namespace, kept apart from the app's bare `v*` tags. */
  tagPrefix: string
  /**
   * Repository paths whose changes reach the published package: every bundled
   * workspace plus the packaging inputs. A commit touching none of them cannot
   * change what `npm install` delivers, so it never moves the CLI version.
   */
  paths: string[]
}

export function readCliReleaseConfig(manifest: unknown): CliReleaseConfig {
  const release = (manifest as { release?: Partial<CliReleaseConfig> } | null)?.release
  if (
    !release ||
    typeof release.package !== 'string' ||
    typeof release.tagPrefix !== 'string' ||
    !Array.isArray(release.paths) ||
    release.paths.length === 0 ||
    !release.paths.every((path) => typeof path === 'string' && path.length > 0)
  ) {
    throw new Error('apps/cli/package.json needs a "release" field with package, tagPrefix, paths.')
  }
  // `v` would collide with the app's own tags and make every app release a CLI one.
  if (!release.tagPrefix || release.tagPrefix === 'v') {
    throw new Error('The CLI tagPrefix must differ from the app tag prefix "v".')
  }
  return { package: release.package, tagPrefix: release.tagPrefix, paths: release.paths }
}

/** Bundled workspaces: the release paths that are themselves pnpm packages. */
export function cliWorkspaces(config: CliReleaseConfig): string[] {
  return config.paths.filter((path) => /^(apps|packages)\/[^/]+$/.test(path))
}

export function cliTag(config: CliReleaseConfig, version: string): string {
  return `${config.tagPrefix}${version.replace(/^v/, '')}`
}

/** The version a CLI tag names, or null for any other tag. */
export function cliVersionFromTag(config: CliReleaseConfig, tag: string): string | null {
  if (!tag.startsWith(config.tagPrefix)) return null
  const parsed = parseSemVer(tag.slice(config.tagPrefix.length))
  return parsed ? formatSemVer(parsed) : null
}

export type CliBaseline = {
  /** Tag the commit range starts from, or null before anything shipped. */
  tag: string | null
  /** Version already on npm (or about to be, for a first release). */
  version: string
  /**
   * The CLI used to ship with the app's version from the app's tag. Until the
   * first `cli-v*` tag exists, the app tag matching the manifest version is the
   * honest starting point — that is the commit the published package came from.
   */
  legacy: boolean
}

export function cliBaseline(input: {
  config: CliReleaseConfig
  tags: readonly string[]
  manifestVersion: string
}): CliBaseline {
  let best: { tag: string; version: string } | null = null
  for (const tag of input.tags) {
    const version = cliVersionFromTag(input.config, tag)
    if (!version) continue
    if (!best || compareSemVer(parseSemVer(version)!, parseSemVer(best.version)!) > 0) {
      best = { tag, version }
    }
  }
  if (best) return { ...best, legacy: false }

  const legacyTag = toTag(input.manifestVersion)
  if (input.tags.includes(legacyTag)) {
    return { tag: legacyTag, version: input.manifestVersion, legacy: true }
  }
  return { tag: null, version: input.manifestVersion, legacy: false }
}

/** `planRelease` for the CLI, with the tag in the CLI namespace. */
export function planCliRelease(input: {
  config: CliReleaseConfig
  baseline: CliBaseline
  commits: readonly CommitInput[]
  allowMajor?: boolean
}): ReleasePlan {
  const plan = planRelease({
    currentVersion: input.baseline.version,
    commits: withoutReleaseCommits(input.commits),
    allowMajor: input.allowMajor ?? false,
    // A legacy baseline already shipped under that number, so it must be bumped.
    firstRelease: input.baseline.tag === null,
  })
  return {
    ...plan,
    tag: plan.next ? cliTag(input.config, plan.next) : null,
    // The reason names versions in tag form; say them in the CLI namespace.
    reason: plan.reason.replace(/(?<![\w-])v(?=\d+\.\d+\.\d+)/g, input.config.tagPrefix),
  }
}

/** Prereleases must not move `latest`, or every `npm install -g` would get a beta. */
export function npmDistTag(version: string): 'latest' | 'next' {
  return parseSemVer(version)?.prerelease ? 'next' : 'latest'
}

/** One `## vX.Y.Z` section for `apps/cli/CHANGELOG.md`. */
export function renderCliNotes(input: {
  config: CliReleaseConfig
  plan: ReleasePlan
  version: string
  baseline: CliBaseline
  /** Operator-written prose placed above the generated commit index. */
  summary?: string
  repoUrl?: string
  date?: string
}): string {
  const plan = { ...input.plan, next: input.version, tag: cliTag(input.config, input.version) }
  return renderReleaseNotes({
    plan,
    fragments: [],
    summary: input.summary,
    repoUrl: input.repoUrl,
    previousTag: input.baseline.tag,
    date: input.date,
  })
}

/**
 * Workspace packages the CLI bundles but the release paths miss. Such a
 * package could change the published bundle without ever proposing a release.
 */
export function uncoveredWorkspaces(
  config: CliReleaseConfig,
  bundled: readonly string[],
): string[] {
  const covered = new Set(cliWorkspaces(config))
  return bundled.filter((workspace) => !covered.has(workspace))
}
