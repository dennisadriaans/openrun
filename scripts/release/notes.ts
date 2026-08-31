/**
 * Release notes: the mechanical index plus the human prose.
 *
 * A release section has two halves and they come from different places.
 *
 * - The **prose** is what the release actually means to somebody using Open Run,
 *   written in the negative-relief voice the changelog has always used ("You no
 *   longer …"). It comes from `changelog.d/` fragments and from whatever is
 *   sitting in `## Unreleased`.
 * - The **index** is every commit in the range, grouped by type. It comes from
 *   the conventional subjects and is generated, never written.
 *
 * Keeping them apart is what lets the version be fully automatic without the
 * changelog degenerating into a list of commit subjects.
 */

import type { ReleasePlan } from './plan.ts'

export type Fragment = {
  /** File name inside `changelog.d/`, used for stable ordering and error messages. */
  name: string
  body: string
}

export type NotesInput = {
  plan: ReleasePlan
  /** `changelog.d/` entries being folded into this release. */
  fragments: readonly Fragment[]
  /** Bullets rescued from a hand-maintained `## Unreleased` section. */
  carried?: readonly string[]
  /** `https://github.com/owner/repo`, for PR and compare links. */
  repoUrl?: string
  /** Previous tag, for the compare link. Omitted on a first release. */
  previousTag?: string | null
  /** ISO date stamped beside the heading. */
  date?: string
}

/** One `## vX.Y.Z` section, ready to splice into CHANGELOG.md. */
export function renderReleaseNotes(input: NotesInput): string {
  const { plan } = input
  if (!plan.next) throw new Error('Cannot render notes for a plan with no next version.')

  const lines: string[] = []
  const date = input.date ?? new Date().toISOString().slice(0, 10)
  lines.push(`## v${plan.next} — ${date}`, '')

  if (plan.breaking.length > 0) {
    lines.push(renderBreaking(plan), '')
  }

  const prose = [
    ...(input.carried ?? []).map((text) => text.trim()).filter(Boolean),
    ...input.fragments.map((fragment) => fragment.body),
  ]
    .map(toBullet)
    .filter(Boolean)

  if (prose.length > 0) {
    lines.push(...prose, '')
  }

  for (const section of plan.sections) {
    lines.push(`### ${section.title}`, '')
    for (const commit of section.commits) {
      lines.push(`- ${renderCommit(commit.scope, commit.description, commit.pr, input.repoUrl)}`)
    }
    lines.push('')
  }

  if (plan.unconventional.length > 0) {
    lines.push('### Uncategorised', '')
    for (const commit of plan.unconventional) {
      lines.push(`- ${renderCommit(null, commit.description, commit.pr, input.repoUrl)}`)
    }
    lines.push('')
  }

  if (input.repoUrl && input.previousTag) {
    lines.push(
      `**Full changelog**: [\`${input.previousTag}...${plan.tag}\`](${input.repoUrl}/compare/${input.previousTag}...${plan.tag})`,
      '',
    )
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function renderBreaking(plan: ReleasePlan): string {
  const count = plan.breaking.length
  const noun = `${count} breaking change${count === 1 ? '' : 's'}`

  // Say why the number did not move as far as the commits asked for, so nobody
  // has to reverse-engineer the policy from the version.
  if (plan.held === 'pre-1.0') {
    return `> **${noun}.** Open Run is pre-1.0, so this lands as a minor release — read the entries below before upgrading.`
  }
  if (plan.held === 'policy') {
    return `> **${noun}.** Released as a minor; the major is cut by hand.`
  }
  return `> **${noun}.** Read the entries below before upgrading.`
}

function renderCommit(
  scope: string | null,
  description: string,
  pr: number | null,
  repoUrl?: string,
): string {
  const prefix = scope ? `**${scope}:** ` : ''
  if (!pr) return `${prefix}${description}`

  const link = repoUrl ? `[#${pr}](${repoUrl}/pull/${pr})` : `#${pr}`
  return `${prefix}${description} (${link})`
}

/**
 * Renders a fragment as one bullet.
 *
 * Fragments are written as prose paragraphs, so the first paragraph becomes the
 * bullet and any others are indented under it rather than being flattened into
 * one run-on line.
 */
export function toBullet(body: string): string {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)

  if (paragraphs.length === 0) return ''

  const [first, ...rest] = paragraphs
  const head = `- ${(first ?? '').replace(/^[-*]\s+/, '')}`
  return [head, ...rest.map((paragraph) => `\n  ${paragraph}`)].join('\n')
}

const UNRELEASED = /^##\s+Unreleased\s*$/im

export type SplitChangelog = {
  /** Everything above `## Unreleased`, including the title and format note. */
  preamble: string
  /** Bullets currently sitting under `## Unreleased`. */
  carried: string[]
  /** Every previously released section, untouched. */
  rest: string
}

/**
 * Splits CHANGELOG.md around its `## Unreleased` section.
 *
 * The hand-maintained section is not deleted — its bullets are carried into the
 * release being cut, which is how the existing backlog migrates into the first
 * automated release instead of being stranded above it.
 */
export function splitChangelog(source: string): SplitChangelog {
  const match = UNRELEASED.exec(source)
  if (!match) {
    // No Unreleased section: everything before the first release heading is preamble.
    const firstRelease = /^##\s+/m.exec(source)
    if (!firstRelease) return { preamble: source.trimEnd(), carried: [], rest: '' }
    return {
      preamble: source.slice(0, firstRelease.index).trimEnd(),
      carried: [],
      rest: source.slice(firstRelease.index).trimEnd(),
    }
  }

  const preamble = source.slice(0, match.index).trimEnd()
  const after = source.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(after)

  const body = next ? after.slice(0, next.index) : after
  const rest = next ? after.slice(next.index).trimEnd() : ''

  return { preamble, carried: splitBullets(body), rest }
}

/** Top-level `- ` bullets, with wrapped and indented continuation lines kept. */
function splitBullets(body: string): string[] {
  const bullets: string[] = []
  let current: string[] = []

  for (const line of body.split('\n')) {
    if (/^[-*]\s+/.test(line)) {
      if (current.length > 0) bullets.push(current.join('\n'))
      current = [line.replace(/^[-*]\s+/, '')]
    } else if (current.length > 0 && line.trim()) {
      current.push(line.trim())
    } else if (current.length > 0) {
      bullets.push(current.join('\n'))
      current = []
    }
  }
  if (current.length > 0) bullets.push(current.join('\n'))

  return bullets.map((bullet) => bullet.trim()).filter(Boolean)
}

/** Rewrites CHANGELOG.md with the new section on top and `## Unreleased` emptied. */
export function insertRelease(source: string, section: string): string {
  const { preamble, rest } = splitChangelog(source)
  return `${[preamble, '## Unreleased', '', section.trimEnd(), rest]
    .filter(Boolean)
    .join('\n\n')
    .trimEnd()}\n`
}

/**
 * Pulls one release's section back out of CHANGELOG.md.
 *
 * `publish` needs the notes it is about to attach to a GitHub Release, and
 * reading them back from the changelog means the tag, the release page and the
 * committed file are the same words by construction.
 */
export function extractRelease(source: string, version: string): string | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Consume the whole heading line (it carries a date), but do not let `0.2.1`
  // match the heading for `0.2.10`.
  const heading = new RegExp(`^##\\s+v${escaped}(?![\\d.])[^\\n]*\\n?`, 'm')

  const match = heading.exec(source)
  if (!match) return null

  const after = source.slice(match.index + match[0].length)
  const next = /^##\s+/m.exec(after)
  const body = next ? after.slice(0, next.index) : after

  return body.trim() || null
}
