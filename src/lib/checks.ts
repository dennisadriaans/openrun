/**
 * Verification checks — the "definition of done" for an *unattended* run.
 *
 * A check is a shell command run in the run's worktree after an automation's
 * turn finishes (`pnpm typecheck`, `pnpm test`, …). Without them a run is
 * "successful" whenever the CLI exited 0, which an agent does just as happily
 * after writing code that does not compile. Checks turn that into evidence, and
 * feed the failures back to the agent for a repair turn.
 *
 * They deliberately do **not** run on turns a human typed — see
 * `executor.concludeTurn`. In a live conversation you are the verification, and
 * making every chat message wait on a test suite (while holding the workspace
 * lock) costs more than it tells you.
 *
 * Definitions are stored per project as a JSON array on `projects.checks`, next
 * to `setupCommand` — setup prepares a worktree, checks judge what came out of
 * it. Kept in `lib/` (no Node imports) so the project form, the run detail page
 * and the server runner all share one parser and one set of error messages.
 */

export type CheckDef = {
  /** Stable id so results can be correlated across runs of the same project. */
  id: string
  /** Short human label shown in the UI, e.g. "Types". */
  name: string
  /** Shell command executed in the worktree root. */
  command: string
}

/**
 * One budget for every check. This was configurable per check and nobody has a
 * reason to tune it: a check that needs longer than ten minutes is one the run
 * should not be waiting on at all.
 */
export const CHECK_TIMEOUT_MS = 10 * 60 * 1000
/** Guardrail: verification runs serially, so a long list stalls the workspace. */
export const MAX_CHECKS = 10
export const MAX_CHECK_NAME_CHARS = 60
export const MAX_CHECK_COMMAND_CHARS = 500

/** Bytes of combined output kept per check — enough to diagnose, bounded for SQLite. */
export const CHECK_OUTPUT_TAIL_CHARS = 8_000

function checkId(): string {
  return `chk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function coerceCheck(raw: unknown): CheckDef | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const command = typeof obj.command === 'string' ? obj.command.trim() : ''
  if (!command) return null
  return {
    id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : checkId(),
    name:
      typeof obj.name === 'string' && obj.name.trim()
        ? obj.name.trim().slice(0, MAX_CHECK_NAME_CHARS)
        : command.slice(0, MAX_CHECK_NAME_CHARS),
    command,
  }
}

/**
 * Lenient read path — used everywhere a stored value is displayed. Never
 * throws: a corrupt row degrades to "no checks" rather than breaking the page.
 */
export function parseChecks(raw: string | null | undefined): CheckDef[] {
  if (!raw || !raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: CheckDef[] = []
  for (const entry of parsed) {
    const def = coerceCheck(entry)
    if (def) out.push(def)
    if (out.length >= MAX_CHECKS) break
  }
  return out
}

export function serializeChecks(defs: CheckDef[]): string {
  return JSON.stringify(defs)
}

export function tooManyChecksMessage(): string {
  return `A project can have at most ${MAX_CHECKS} checks — they run one after another after every turn.`
}

export function emptyCheckCommandMessage(): string {
  return 'Every check needs a command to run (for example `pnpm test`).'
}

export function checkCommandTooLongMessage(): string {
  return `A check command is limited to ${MAX_CHECK_COMMAND_CHARS} characters — put anything longer in a script and call that.`
}

/**
 * Strict write path — used on save. Throws the same messages the form shows so
 * a bad definition is rejected instead of stored and then failing at run time
 * (the pattern `assertArgsTemplate` established for runtime templates).
 */
export function assertChecks(defs: unknown): CheckDef[] {
  if (defs == null) return []
  if (!Array.isArray(defs)) {
    throw new Error('Checks must be a list.')
  }
  if (defs.length > MAX_CHECKS) {
    throw new Error(tooManyChecksMessage())
  }
  const out: CheckDef[] = []
  for (const raw of defs) {
    if (!raw || typeof raw !== 'object') {
      throw new Error(emptyCheckCommandMessage())
    }
    const obj = raw as Record<string, unknown>
    const command = typeof obj.command === 'string' ? obj.command.trim() : ''
    if (!command) throw new Error(emptyCheckCommandMessage())
    if (command.length > MAX_CHECK_COMMAND_CHARS) {
      throw new Error(checkCommandTooLongMessage())
    }
    const def = coerceCheck(raw)
    if (!def) throw new Error(emptyCheckCommandMessage())
    out.push(def)
  }
  return out
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export type PackageRunner = 'pnpm' | 'npm' | 'yarn' | 'bun'

/**
 * Script names we know how to judge a run by, in the order they should run:
 * cheapest and most decisive first, so a type error is reported in seconds
 * instead of after a full test suite.
 */
const SUGGESTED_SCRIPTS: Array<{ script: string; name: string }> = [
  { script: 'typecheck', name: 'Types' },
  { script: 'lint', name: 'Lint' },
  { script: 'test', name: 'Tests' },
]

function runScript(runner: PackageRunner, script: string): string {
  return runner === 'npm' ? `npm run ${script}` : `${runner} ${script}`
}

/**
 * Propose checks from a package.json `scripts` map. Used when a project is
 * added so the common case needs no configuration at all — the user reviews
 * the suggestion instead of writing it.
 */
export function suggestChecksFromScripts(
  scripts: Record<string, unknown> | null | undefined,
  runner: PackageRunner = 'npm',
): CheckDef[] {
  if (!scripts || typeof scripts !== 'object') return []
  const out: CheckDef[] = []
  for (const { script, name } of SUGGESTED_SCRIPTS) {
    const value = scripts[script]
    if (typeof value !== 'string' || !value.trim()) continue
    out.push({ id: `chk_${script}`, name, command: runScript(runner, script) })
  }
  return out
}
