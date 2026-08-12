/**
 * Detect a failed `gh` / `git` shipping attempt inside a run's output.
 *
 * An agent that shells out to `gh pr create` can fail (unauthenticated, no
 * remote, binary missing) while the *turn* still exits 0 — the failure is
 * buried in the log and the run looks green. Spike notes live in
 * `changelog.d/05-github-tool-calls-spike.md`; core behavior in
 * `changelog.d/05-github-tool-calls-core.md`.
 *
 * This is a best-effort, browser-safe string scan over combined stdout+stderr.
 * It only matches phrases `gh`/`git` emit on real failures, so a passing run
 * that merely mentions "gh auth login" in prose is unlikely to trip it.
 */

export type GhFailure = {
  failed: boolean
  reason?: string
}

const SIGNATURES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /not logged into any github hosts/i,
    reason: 'gh is not authenticated (run: gh auth login)',
  },
  {
    pattern: /gh auth login|To authenticate, please run/i,
    reason: 'gh asked the user to authenticate (gh auth login)',
  },
  {
    pattern: /no git remotes found|none of the git remotes configured/i,
    reason: 'no git remote is configured for gh pr create',
  },
  {
    pattern: /gh: command not found|gh: not found|command not found: gh/i,
    reason: 'the gh CLI is not installed on PATH',
  },
  {
    pattern: /must be on a branch|no commits between/i,
    reason: 'gh pr create had nothing to open a PR from',
  },
]

export function detectGhFailure(text: string): GhFailure {
  if (!text) return { failed: false }
  for (const { pattern, reason } of SIGNATURES) {
    if (pattern.test(text)) return { failed: true, reason }
  }
  return { failed: false }
}
