/**
 * Turning a commit range into a release decision.
 *
 * This module is the whole of the "what version is next" question, and it is a
 * pure function on purpose: the scheduled job, the `pnpm release:plan` command
 * and any UI that previews the pending release all get the same answer for the
 * same input, and none of them consults a model to get it.
 *
 * What this module does *not* do is write the changelog prose. Conventional
 * subjects are precise about scope and useless as user-facing copy —
 * `feat(tasks): select and bulk delete automations` is not "You no longer delete
 * automations one row at a time". So commits own the version and `changelog.d/`
 * owns the words; `notes.ts` folds the two together.
 */

import type { CommitInput, ParsedCommit } from './conventional.ts'
import { COMMIT_TYPES, commitBump, parseCommit, typeMeta } from './conventional.ts'
import type { BumpHold, BumpKind } from './semver.ts'
import { applyBump, formatSemVer, parseSemVer, resolveBump, toTag } from './semver.ts'

export type ReleaseSection = {
  title: string
  order: number
  commits: ParsedCommit[]
}

export type ReleasePlan = {
  /** Version the range starts from. */
  current: string
  /** Version the release would create, or null when nothing is releasable. */
  next: string | null
  /** `vX.Y.Z`, or null when nothing is releasable. */
  tag: string | null
  /** Bump that will be applied, or null when nothing is releasable. */
  bump: BumpKind | null
  /** Bump the commits asked for, before policy clamping. */
  requestedBump: BumpKind | null
  /** Set when policy held the bump below what the commits asked for. */
  held: BumpHold | null
  releasable: boolean
  /** One sentence, always populated — printed by the CLI and the workflow summary. */
  reason: string
  /** Every commit in the range, grouped for the notes and ordered by section. */
  sections: ReleaseSection[]
  /** Commits marked breaking, whatever their type. */
  breaking: ParsedCommit[]
  /** Commits whose subject is not a conventional commit at all. */
  unconventional: ParsedCommit[]
  /** Commit count per type; `unknown` collects unconventional subjects. */
  counts: Record<string, number>
  total: number
}

const BUMP_RANK: Record<BumpKind, number> = { patch: 1, minor: 2, major: 3 }

/** The higher-precedence of two bumps, treating null as "no opinion". */
function maxBump(a: BumpKind | null, b: BumpKind | null): BumpKind | null {
  if (!a) return b
  if (!b) return a
  return BUMP_RANK[a] >= BUMP_RANK[b] ? a : b
}

export type ReleasePlanInput = {
  /** Base version — the newest release tag, or package.json for a first release. */
  currentVersion: string
  commits: readonly CommitInput[]
  /**
   * Allow an automatic major once the project is past 1.0. Off by default so an
   * unattended release can never move the headline number on its own.
   */
  allowMajor?: boolean
  /**
   * No release tags exist yet. The first release publishes `currentVersion`
   * as-is instead of bumping past it, so `v0.1.0` is a version that shipped
   * rather than one the history skipped over.
   */
  firstRelease?: boolean
}

/** Decides whether the range warrants a release, and which one. */
export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const current = parseSemVer(input.currentVersion)
  if (!current) {
    throw new Error(`Cannot plan a release from "${input.currentVersion}": not a SemVer version.`)
  }

  const commits = input.commits.map(parseCommit)
  const currentText = formatSemVer(current)

  const counts: Record<string, number> = {}
  const bySection = new Map<string, ReleaseSection>()
  const breaking: ParsedCommit[] = []
  const unconventional: ParsedCommit[] = []

  let requested: BumpKind | null = null

  for (const commit of commits) {
    const key = commit.type ?? 'unknown'
    counts[key] = (counts[key] ?? 0) + 1

    if (commit.breaking) breaking.push(commit)

    const meta = typeMeta(commit)
    if (!meta) {
      unconventional.push(commit)
      // Deliberately no bump: an unrecognised subject is reported, not guessed at.
      continue
    }

    requested = maxBump(requested, commitBump(commit))

    const section = bySection.get(meta.section) ?? {
      title: meta.section,
      order: meta.order,
      commits: [],
    }
    section.commits.push(commit)
    bySection.set(meta.section, section)
  }

  const sections = [...bySection.values()].sort((a, b) => a.order - b.order)
  const empty = emptyPlan(currentText, commits, sections, breaking, unconventional, counts)

  if (commits.length === 0) {
    return { ...empty, reason: `No commits since ${toTag(currentText)}.` }
  }

  if (!requested) {
    return {
      ...empty,
      reason:
        `${commits.length} commit${commits.length === 1 ? '' : 's'} since ${toTag(currentText)}, ` +
        'none of them releasable — a release would have nothing to announce.',
    }
  }

  if (input.firstRelease) {
    return {
      ...empty,
      next: currentText,
      tag: toTag(currentText),
      // No bump: the version in package.json is the one being published.
      bump: null,
      requestedBump: requested,
      releasable: true,
      reason: `First release: ${toTag(currentText)} from ${commits.length} commits.`,
    }
  }

  const resolved = resolveBump(current, requested, { allowMajor: input.allowMajor })
  const next = applyBump(current, resolved.bump)
  const nextText = formatSemVer(next)

  return {
    ...empty,
    next: nextText,
    tag: toTag(nextText),
    bump: resolved.bump,
    requestedBump: resolved.requested,
    held: resolved.held,
    releasable: true,
    reason: describe(currentText, nextText, resolved.bump, resolved.held, breaking.length),
  }
}

function emptyPlan(
  current: string,
  commits: ParsedCommit[],
  sections: ReleaseSection[],
  breaking: ParsedCommit[],
  unconventional: ParsedCommit[],
  counts: Record<string, number>,
): ReleasePlan {
  return {
    current,
    next: null,
    tag: null,
    bump: null,
    requestedBump: null,
    held: null,
    releasable: false,
    reason: '',
    sections,
    breaking,
    unconventional,
    counts,
    total: commits.length,
  }
}

function describe(
  current: string,
  next: string,
  bump: BumpKind,
  held: BumpHold | null,
  breakingCount: number,
): string {
  const base = `${bump} release: ${toTag(current)} → ${toTag(next)}.`
  if (!held) return base

  const changes = `${breakingCount} breaking change${breakingCount === 1 ? '' : 's'}`
  return held === 'pre-1.0'
    ? `${base} ${changes} held at minor because the project is pre-1.0.`
    : `${base} ${changes} held at minor — cut the major by hand when you mean it.`
}

/** `feat 3 · fix 4 · docs 2`, in the changelog's own section order. */
export function summariseCounts(counts: Record<string, number>): string {
  const order = (type: string) => COMMIT_TYPES[type]?.order ?? 99
  return Object.entries(counts)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([type, count]) => `${type} ${count}`)
    .join(' · ')
}
