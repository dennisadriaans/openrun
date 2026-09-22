/**
 * Ship plan: how the run's own agent groups uncommitted work into conventional
 * commits and titles the pull request that carries them.
 *
 * Pure and browser-safe (same rule as the rest of `src/lib/**`): the prompt is
 * built and the answer parsed here so the server write path and any client
 * preview read the identical shapes. The agent only ever *proposes* — nothing
 * in this module touches git.
 */

/** One conventional commit and the run-owned paths it stages. */
export type ShipCommit = {
  /** Conventional Commits subject: `type(scope): summary`, ≤ 60 chars. */
  message: string
  /** Repo-relative paths, a subset of the run's changed files. */
  paths: string[]
  /** Optional body explaining the *why*, wrapped by the caller. */
  body?: string
}

export type ShipPlan = {
  commits: ShipCommit[]
  prTitle: string
  prBody: string
}

/** Conventional Commits types this repo accepts, in the order agents see them. */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
] as const

const SUBJECT_MAX = 60

const SUBJECT_RE = new RegExp(`^(${CONVENTIONAL_TYPES.join('|')})(\\([^()\\s]+\\))?!?: .+$`)

/**
 * Why a subject is not a usable conventional commit, or `null` when it is.
 * Deliberately mirrors `lib/release/conventional.ts` on the parts that decide
 * the next version — a plan that fails this would fail CI on the PR title too.
 */
export function commitSubjectProblem(subject: string): string | null {
  const line = subject.trim()
  if (!line) return 'Commit message is empty'
  if (line.includes('\n')) return 'Commit subject must be a single line'
  if (!SUBJECT_RE.test(line)) {
    return `"${line}" is not \`type(scope): summary\` (${CONVENTIONAL_TYPES.join(', ')})`
  }
  if (line.length > SUBJECT_MAX) return `Commit subject is longer than ${SUBJECT_MAX} characters`
  if (line.endsWith('.')) return 'Commit subject must not end with a period'
  const summary = line.slice(line.indexOf(': ') + 2)
  if (/^[A-Z]/.test(summary)) return 'Commit summary must be lowercase imperative'
  return null
}

/**
 * The instruction handed to the run's runtime. It answers from the diff alone:
 * grouping is a reading task, and letting it edit files mid-ship would change
 * the very tree the plan describes.
 */
export function buildShipPlanPrompt(input: {
  files: { path: string; status: string; additions: number; deletions: number }[]
  /** Truncated `git diff` for context; may be empty when the diff is huge. */
  diff: string
  /** The run's task name / first prompt, as a hint at intent. */
  taskName: string
  baseBranch: string
}): string {
  const fileList = input.files
    .map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`)
    .join('\n')

  return `You are preparing uncommitted work in a git repository to be shipped as a pull request.

Group the changed files below into one or more commits, one shippable idea per commit,
and write a pull request that carries them. Do NOT edit, create, or delete any files, do
not run git, and do not use tools — answer from the diff you are given.

Intent of the work: ${input.taskName || '(not stated)'}
Pull request base branch: ${input.baseBranch || '(repository default)'}

Changed files:
${fileList}

${input.diff ? `Diff:\n\`\`\`diff\n${input.diff}\n\`\`\`\n` : ''}
Respond with ONLY a JSON object (no prose, no markdown fences):
{
  "commits": [{ "message": string, "body": string, "paths": string[] }],
  "prTitle": string,
  "prBody": string
}

Rules:
- "message" is a Conventional Commits subject: \`type(scope): summary\` where type is one of
  ${CONVENTIONAL_TYPES.join(', ')} (append \`!\` before the colon for a breaking change).
  The scope names the area, not the path, and is optional. The summary is lowercase
  imperative ("add", not "added"), has no trailing period, and is at most ${SUBJECT_MAX} characters.
- "body" explains the *why* the diff cannot show, wrapped at 80 columns. Use "" when the
  subject says it all.
- "paths" lists the repo-relative paths from the list above that belong to that commit.
  Every changed file must appear in exactly one commit. Do not invent paths.
- Prefer one commit per feature. Split only when the files genuinely tell separate stories.
- "prTitle" follows the same Conventional Commits rules as a commit subject; it is what
  lands on the base branch when the pull request is squashed.
- "prBody" starts with a "## Summary" section of two to four bullets saying what the change
  does for a user, then a "## Test plan" section of unchecked \`- [ ]\` boxes a reviewer can
  actually perform. No other headings.`
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Read a ship plan out of CLI stdout. Returns `null` when nothing parseable is
 * there, so the caller can refuse rather than commit something half-understood.
 */
export function parseShipPlan(raw: string): ShipPlan | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>
  const rawCommits = Array.isArray(obj.commits) ? obj.commits : []
  const commits: ShipCommit[] = []
  for (const item of rawCommits) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const message = asString(c.message).trim()
    const paths = Array.isArray(c.paths)
      ? c.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      : []
    if (!message || paths.length === 0) continue
    const body = asString(c.body).trim()
    commits.push(body ? { message, paths, body } : { message, paths })
  }
  if (commits.length === 0) return null

  return {
    commits,
    prTitle: asString(obj.prTitle).trim(),
    prBody: asString(obj.prBody).trim(),
  }
}

/**
 * Why a parsed plan cannot be applied to `changed`, or `null` when it can.
 *
 * Checked before the first commit so a bad plan leaves the tree untouched:
 * a partially applied plan is far harder to undo than a refused one.
 */
export function shipPlanProblem(plan: ShipPlan, changed: string[]): string | null {
  const known = new Set(changed)
  const seen = new Set<string>()

  for (const commit of plan.commits) {
    const problem = commitSubjectProblem(commit.message)
    if (problem) return problem
    for (const path of commit.paths) {
      if (!known.has(path)) return `The plan names "${path}", which is not a changed file`
      if (seen.has(path)) return `The plan puts "${path}" in more than one commit`
      seen.add(path)
    }
  }

  const missing = changed.filter((p) => !seen.has(p))
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).join(', ')
    return `The plan leaves ${missing.length} changed file${
      missing.length === 1 ? '' : 's'
    } uncommitted: ${shown}${missing.length > 3 ? '…' : ''}`
  }

  if (!plan.prTitle) return 'The plan has no pull request title'
  return commitSubjectProblem(plan.prTitle)
}

/** Full commit message: subject, blank line, body. */
export function commitMessageText(commit: ShipCommit): string {
  return commit.body ? `${commit.message}\n\n${commit.body}` : commit.message
}

/** Fallback plan when the agent cannot be reached or answers unusably. */
export function fallbackShipPlan(input: { taskName: string; changed: string[] }): ShipPlan {
  const summary = input.taskName
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .slice(0, SUBJECT_MAX - 8)
  const message = `chore: ${summary || 'apply agent changes'}`
  return {
    commits: [{ message, paths: [...input.changed] }],
    prTitle: message,
    prBody: `## Summary\n- ${input.taskName || 'Changes produced by an Open Run run.'}\n\n## Test plan\n- [ ] Review the diff and exercise the affected surface`,
  }
}
