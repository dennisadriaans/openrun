/**
 * Conventional Commits, read as release metadata.
 *
 * `main` takes squashed PRs only and the squash commit is the PR title verbatim,
 * so one commit on `main` is one shippable idea — which makes the subject line
 * the machine-readable half of a release. The prose half lives in
 * `changelog.d/`; see `plan.ts` for why the two are kept apart.
 */

import type { BumpKind } from './semver.ts'

export type CommitInput = {
  sha: string
  subject: string
  /** Full commit body, searched for a `BREAKING CHANGE:` footer. */
  body?: string
}

export type ParsedCommit = {
  sha: string
  /** Lowercase type (`feat`, `fix`, …), or null when the subject is not conventional. */
  type: string | null
  scope: string | null
  /** `!` before the colon, or a `BREAKING CHANGE:` footer in the body. */
  breaking: boolean
  /** Subject with the type, scope and trailing `(#42)` removed. */
  description: string
  /** PR number parsed from the trailing `(#42)` a squash merge appends. */
  pr: number | null
  /** The unmodified subject, for error messages and release notes fallbacks. */
  subject: string
}

export type CommitTypeMeta = {
  /** The bump this type demands, or null when it alone never warrants a release. */
  bump: BumpKind | null
  /** Changelog heading, in the UnJS/Nuxt style. */
  section: string
  /** Section order in the generated notes. */
  order: number
}

/**
 * The type table. `bump: null` is the load-bearing part of "don't cut a release
 * just because Monday arrived" — a range of only docs and chores produces no
 * release at all rather than a meaningless patch.
 *
 * `revert` is a patch on purpose: undoing shipped behaviour is a user-visible
 * change even though the diff only removes code.
 */
export const COMMIT_TYPES: Readonly<Record<string, CommitTypeMeta>> = {
  feat: { bump: 'minor', section: '🚀 Features', order: 1 },
  fix: { bump: 'patch', section: '🩹 Fixes', order: 2 },
  perf: { bump: 'patch', section: '⚡ Performance', order: 3 },
  revert: { bump: 'patch', section: '⏪ Reverts', order: 4 },
  refactor: { bump: null, section: '💅 Refactors', order: 5 },
  docs: { bump: null, section: '📖 Documentation', order: 6 },
  test: { bump: null, section: '✅ Tests', order: 7 },
  build: { bump: null, section: '📦 Build', order: 8 },
  ci: { bump: null, section: '🤖 CI', order: 9 },
  chore: { bump: null, section: '🏡 Chore', order: 10 },
}

/** The types `pr-title.yml` accepts, derived so the two can never drift. */
export const COMMIT_TYPE_NAMES: readonly string[] = Object.keys(COMMIT_TYPES)

const SUBJECT = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/
const TRAILING_PR = /\s*\(#(\d+)\)\s*$/
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m

/**
 * Parses one commit. A subject that is not conventional comes back with
 * `type: null` rather than throwing — `main` predates the PR-title gate, and a
 * plan that silently dropped those commits would understate the release.
 */
export function parseCommit(input: CommitInput): ParsedCommit {
  const subject = input.subject.trim()
  const match = SUBJECT.exec(subject)

  const footerBreaking = BREAKING_FOOTER.test(input.body ?? '')

  if (!match) {
    return {
      sha: input.sha,
      type: null,
      scope: null,
      breaking: footerBreaking,
      description: stripPr(subject).text,
      pr: stripPr(subject).pr,
      subject,
    }
  }

  const [, type, scope, bang, rest] = match
  const { text, pr } = stripPr(rest ?? '')

  return {
    sha: input.sha,
    type: (type ?? '').toLowerCase(),
    scope: scope ? scope.toLowerCase() : null,
    breaking: Boolean(bang) || footerBreaking,
    description: text,
    pr,
    subject,
  }
}

function stripPr(text: string): { text: string; pr: number | null } {
  const match = TRAILING_PR.exec(text)
  if (!match) return { text: text.trim(), pr: null }
  return { text: text.slice(0, match.index).trim(), pr: Number(match[1]) }
}

/** Accepts the release commit before or after GitHub appends its squash PR number. */
export function isReleaseCommitSubject(subject: string, tag: string): boolean {
  const commit = parseCommit({ sha: '', subject })
  return commit.type === 'chore' && commit.scope === 'release' && commit.description === tag
}

/** Metadata for a parsed commit's type, or null for an unknown/unconventional one. */
export function typeMeta(commit: ParsedCommit): CommitTypeMeta | null {
  if (!commit.type) return null
  return COMMIT_TYPES[commit.type] ?? null
}

/**
 * The bump a single commit demands.
 *
 * A breaking marker outranks the type, so `refactor!:` still forces a major even
 * though a plain `refactor:` never triggers a release on its own.
 */
export function commitBump(commit: ParsedCommit): BumpKind | null {
  if (commit.breaking) return 'major'
  return typeMeta(commit)?.bump ?? null
}

export type TitleVerdict = { ok: boolean; error: string | null }

/** The subject-length cap. A squash title becomes the commit subject on `main`. */
export const MAX_SUBJECT_LENGTH = 60

/**
 * Validates a PR title against the commit rules.
 *
 * One implementation, used by `pnpm ship` before it opens the PR and by the
 * `PR title` workflow that gates the merge — so the local check and the CI
 * check cannot drift into disagreeing about the same title.
 */
export function validateCommitTitle(title: string): TitleVerdict {
  const trimmed = title.trim()
  const fail = (error: string): TitleVerdict => ({ ok: false, error })

  const match = SUBJECT.exec(trimmed)
  if (!match) {
    return fail(
      `Not a conventional commit. Use "type(scope): summary" with type one of: ${COMMIT_TYPE_NAMES.join(', ')}.`,
    )
  }

  const [, type, scope, , rest] = match
  if (!COMMIT_TYPES[(type ?? '').toLowerCase()]) {
    return fail(`Unknown type "${type}". Use one of: ${COMMIT_TYPE_NAMES.join(', ')}.`)
  }
  if (scope && !/^[a-z0-9-]+$/.test(scope)) {
    return fail(`Scope "${scope}" must be lowercase letters, digits or dashes.`)
  }
  if (trimmed.length > MAX_SUBJECT_LENGTH) {
    return fail(`Title is ${trimmed.length} characters; the limit is ${MAX_SUBJECT_LENGTH}.`)
  }

  const subject = rest ?? ''
  if (/^[A-Z]/.test(subject)) {
    return fail('Subject must be lowercase imperative ("add", not "Added").')
  }
  if (subject.endsWith('.')) return fail('Drop the trailing period.')

  return { ok: true, error: null }
}
