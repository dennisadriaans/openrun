/**
 * SemVer arithmetic for the release pipeline.
 *
 * Browser-safe and dependency-free, like everything else in `lib/`: the same
 * module answers "what would the next release be?" for `pnpm release:plan`, for
 * the GitHub Action that opens the release PR, and for any UI that wants to show
 * the pending release. No LLM is ever consulted for a version number — given a
 * base version and a set of commits the answer is a pure function.
 */

export type SemVer = {
  major: number
  minor: number
  patch: number
  /** Dot-separated identifiers after `-`, e.g. `beta.1`. Absent on a stable release. */
  prerelease?: string
}

export type BumpKind = 'major' | 'minor' | 'patch'

/** Why the bump that got applied is smaller than the one the commits asked for. */
export type BumpHold = 'pre-1.0' | 'policy'

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parses `1.2.3`, `v1.2.3` or `v1.2.3-beta.1`. Returns null for anything else. */
export function parseSemVer(input: string): SemVer | null {
  const match = PATTERN.exec(input.trim())
  if (!match) return null

  const [, major, minor, patch, prerelease] = match
  const version: SemVer = {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
  }
  if (prerelease) version.prerelease = prerelease
  return version
}

/** `1.2.3` / `1.2.3-beta.1`. No leading `v` — call sites add it for tags. */
export function formatSemVer(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease ? `${core}-${version.prerelease}` : core
}

/** Tag form: always prefixed, so `v` never has to be concatenated by hand. */
export function toTag(version: SemVer | string): string {
  return `v${typeof version === 'string' ? version.replace(/^v/, '') : formatSemVer(version)}`
}

/** Negative / zero / positive, so an array of versions sorts ascending. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch

  // A prerelease sorts *before* the stable release of the same core version.
  if (a.prerelease && !b.prerelease) return -1
  if (!a.prerelease && b.prerelease) return 1
  if (!a.prerelease || !b.prerelease) return 0

  return comparePrerelease(a.prerelease, b.prerelease)
}

function comparePrerelease(a: string, b: string): number {
  const left = a.split('.')
  const right = b.split('.')

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i]
    const r = right[i]
    // A shorter set of identifiers sorts lower, per the SemVer spec.
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue

    const lNum = /^\d+$/.test(l)
    const rNum = /^\d+$/.test(r)
    if (lNum && rNum) return Number(l) - Number(r)
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (lNum) return -1
    if (rNum) return 1
    return l < r ? -1 : 1
  }

  return 0
}

/** Highest of a list of tag strings, ignoring anything unparseable. */
export function highestVersion(tags: readonly string[]): SemVer | null {
  let best: SemVer | null = null
  for (const tag of tags) {
    const parsed = parseSemVer(tag)
    if (!parsed) continue
    if (!best || compareSemVer(parsed, best) > 0) best = parsed
  }
  return best
}

/**
 * Applies a bump literally — no policy, no clamping. Use `resolveBump` to get
 * the bump that policy actually permits before calling this.
 *
 * Bumping a prerelease drops the prerelease tag: `1.0.0-beta.1` + patch is
 * `1.0.0`, because the stable release of a version supersedes its prereleases.
 */
export function applyBump(version: SemVer, bump: BumpKind): SemVer {
  if (version.prerelease) {
    const stable = { major: version.major, minor: version.minor, patch: version.patch }
    // Promoting the prerelease already delivers everything a patch would.
    if (bump === 'patch') return stable
    return applyBump(stable, bump)
  }

  switch (bump) {
    case 'major':
      return { major: version.major + 1, minor: 0, patch: 0 }
    case 'minor':
      return { major: version.major, minor: version.minor + 1, patch: 0 }
    case 'patch':
      return { major: version.major, minor: version.minor, patch: version.patch + 1 }
  }
}

export type ResolvedBump = {
  /** The bump that will actually be applied. */
  bump: BumpKind
  /** The bump the commits asked for, before any clamping. */
  requested: BumpKind
  /** Set when `bump` is smaller than `requested`, naming the rule that held it. */
  held: BumpHold | null
}

/**
 * Decides which bump policy permits.
 *
 * Two rules hold a major back, and both are deliberate:
 *
 * - **Pre-1.0.** Below `1.0.0` a breaking change is a minor bump — that is what
 *   the leading zero means in SemVer, not a reason to jump to `1.0.0`. Reaching
 *   1.0 is a product decision, never a side effect of a `feat!` merging.
 * - **Policy.** At or past 1.0 an automatic major is still gated on
 *   `allowMajor`, so an unattended Monday release can never move the headline
 *   number on its own. The release PR says the breaking changes are there and a
 *   human cuts the major.
 */
export function resolveBump(
  version: SemVer,
  requested: BumpKind,
  options: { allowMajor?: boolean } = {},
): ResolvedBump {
  if (requested !== 'major') return { bump: requested, requested, held: null }

  if (version.major === 0) return { bump: 'minor', requested, held: 'pre-1.0' }
  if (!options.allowMajor) return { bump: 'minor', requested, held: 'policy' }

  return { bump: 'major', requested, held: null }
}
