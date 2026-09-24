/**
 * Runtime "may open PRs" capability.
 *
 * The GitHub-tool-calls spike found that a spawned child already inherits a
 * working `gh` login, but recommended gating in-turn PR creation behind an
 * explicit per-runtime capability rather than letting every job inherit push
 * credentials in its prompt. This helper decides when to append a short
 * instruction telling the agent it may branch / commit / push / open a PR.
 *
 * Pure and browser-safe: the appendix text and the eligibility rule are shared
 * by the executor and its unit tests.
 */
import { isSupervised } from '../runs/supervisedPolicy.ts'
import type { RuntimeMode } from '../runtimes/runtimeMode.ts'

/** The instruction appended to a run's prompt when PR creation is enabled. */
export const PR_PROMPT_APPENDIX = `

---
This automation is allowed to open its own pull request. When you finish making
changes, create a branch, commit your work, push it, and open a PR with the
GitHub CLI (\`gh pr create\`). The \`gh\` login is already available in your
environment. If \`gh\` fails (not authenticated, no remote, not installed),
print the error clearly and stop — do not report success.`

/**
 * The instruction for a run Open Run ships itself (`runs/autoShip.ts`): the
 * checks judge the work first, then the executor commits, pushes and opens the
 * pull request. An agent that ships on its own would skip that judgement.
 */
export const AUTO_SHIP_PROMPT_APPENDIX = `

---
When you finish, Open Run runs this project's checks. If they pass, it commits
your work on a conventional branch and opens the pull request itself. Leave your
changes uncommitted, and do not create branches, push, or run \`gh pr create\`.`

/**
 * A runtime may open a PR only when the capability is enabled AND the access
 * mode actually lets the agent run shell/network tools. Supervised has no live
 * approval channel for a scheduled ship step, so it is excluded here (attended
 * supervised PR creation can be revisited once the approval UI lands).
 */
export function canOpenPullRequests(
  capabilityEnabled: boolean,
  mode: RuntimeMode | string | null | undefined,
): boolean {
  if (!capabilityEnabled) return false
  return !isSupervised(mode)
}

/**
 * Append the PR instruction to a prompt when the runtime is eligible. Returns
 * the prompt unchanged when it is not, so callers can wrap unconditionally.
 */
export function withPrCapability(
  prompt: string,
  capabilityEnabled: boolean,
  mode: RuntimeMode | string | null | undefined,
  /** Open Run ships this run after its checks pass; the agent must not. */
  executorShips = false,
): string {
  if (!canOpenPullRequests(capabilityEnabled, mode)) return prompt
  return prompt + (executorShips ? AUTO_SHIP_PROMPT_APPENDIX : PR_PROMPT_APPENDIX)
}
