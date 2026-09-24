/**
 * Match what a CLI user typed against what this install actually has.
 *
 * `openrun schedule for claude …` names a runtime the way a person does, and
 * the automation needs a runtime id. Same for the workspace: the useful default
 * is "the checkout I am standing in", with a project name or a path as the
 * override.
 *
 * These are the CLI's half of the gate-module contract in AGENTS.md — the
 * refusals are the reasons the server would give, phrased for a terminal, and
 * every one of them lists what the user could have said instead. A CLI cannot
 * grey out a button and explain on hover, so the error message is the only
 * affordance there is.
 *
 * Pure and browser-safe: structural input types rather than imports from
 * `server/*`, so the same matching could back a command palette in the UI.
 */

/** The fields of a `runtimes.list` row this module reads. */
export type RuntimeChoice = {
  id: string
  label: string
  bin: string
  enabled?: number | boolean
  canOpenPrs?: number | boolean
  installed?: boolean
}

/** The fields of a `workspaces.list` row this module reads. */
export type WorkspaceChoice = {
  id: string
  name: string
  path: string
  branch: string
  projectName?: string
  kind?: string
  status?: string
  activeRunId?: string | null
}

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: string }

function truthy(value: number | boolean | undefined): boolean {
  return value === true || value === 1
}

/** `Claude Code` → `claude code`, so a hint matches however it was typed. */
function fold(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Find the runtime a hint names.
 *
 * Exact id, then binary, then label, then a unique prefix — so `cla` works
 * while `c` (claude and codex both) refuses rather than guessing. A hint that
 * matches a disabled runtime says so instead of reporting it missing: "not
 * found" would send the user looking for a typo that is not there.
 */
export function resolveRuntime(
  hint: string,
  runtimes: readonly RuntimeChoice[],
): Resolved<RuntimeChoice> {
  const enabled = runtimes.filter((r) => r.enabled === undefined || truthy(r.enabled))
  const names = enabled.map((r) => r.bin || r.label).join(', ')

  // Nothing to match against beats every other message, hint or no hint —
  // "no runtime called claude" would send the user hunting for a typo.
  if (enabled.length === 0) {
    return {
      ok: false,
      error:
        'No runtimes are enabled. List them with "openrun runtimes"; configure with "openrun api runtimes.save".',
    }
  }

  if (!fold(hint)) {
    const installed = enabled.filter((r) => r.installed !== false)
    if (installed.length === 1) return { ok: true, value: installed[0]! }
    if (installed.length === 0) {
      return {
        ok: false,
        error:
          'No enabled agent CLI is installed. Install one, then run "openrun runtimes" to check it is available.',
      }
    }
    return {
      ok: false,
      error: `Which runtime? Add "for <runtime>" — available: ${installed.map((r) => r.bin || r.label).join(', ')}.`,
    }
  }

  const needle = fold(hint)
  const exact = enabled.filter(
    (r) => fold(r.id) === needle || fold(r.bin) === needle || fold(r.label) === needle,
  )
  if (exact.length === 1) return availableRuntime(exact[0]!)
  if (exact.length > 1) {
    return {
      ok: false,
      error: `"${hint}" matches multiple runtimes. Use an ID from "openrun runtimes".`,
    }
  }

  const prefixed = enabled.filter(
    (r) => fold(r.bin).startsWith(needle) || fold(r.label).startsWith(needle),
  )
  if (prefixed.length === 1) return availableRuntime(prefixed[0]!)
  if (prefixed.length > 1) {
    return {
      ok: false,
      error: `"${hint}" matches ${prefixed.map((r) => r.bin || r.label).join(' and ')}. Be more specific.`,
    }
  }

  const disabled = runtimes.find(
    (r) =>
      !truthy(r.enabled ?? true) && [r.id, r.bin, r.label].some((value) => fold(value) === needle),
  )
  if (disabled) {
    return {
      ok: false,
      error: `Runtime "${hint}" is disabled. Enable it on the Runtimes page, or pick one of ${names}.`,
    }
  }

  return { ok: false, error: `No runtime called "${hint}". This machine has ${names}.` }
}

function availableRuntime(runtime: RuntimeChoice): Resolved<RuntimeChoice> {
  if (runtime.installed === false) {
    return {
      ok: false,
      error: `Runtime "${runtime.bin}" is not installed or is not on PATH. Install it, then check "openrun runtimes".`,
    }
  }
  return { ok: true, value: runtime }
}

/** Longest-first so `/repo/worktrees/a` wins over `/repo` for a nested cwd. */
function byPathDepth(a: WorkspaceChoice, b: WorkspaceChoice): number {
  return b.path.length - a.path.length
}

/** Whether `cwd` is inside `path` (or is it), without touching `node:path`. */
function contains(path: string, cwd: string): boolean {
  if (!path) return false
  const base = path.replace(/\/+$/, '')
  return cwd === base || cwd.startsWith(`${base}/`)
}

/**
 * Find the workspace to run in.
 *
 * With a hint: an absolute path the cwd rule would also have matched, else a
 * project name, workspace name or branch. Without one: the workspace
 * containing `cwd`, but never one above `root` — the Git checkout `cwd` is in —
 * so a submodule or nested repository does not resolve to its parent.
 * Outside a registered checkout, require an explicit hint rather than starting
 * an agent in a different repository.
 */
export function resolveWorkspace(
  hint: string,
  cwd: string,
  workspaces: readonly WorkspaceChoice[],
  root = '',
): Resolved<WorkspaceChoice> {
  const live = workspaces.filter((w) => w.status !== 'archived')
  if (live.length === 0) {
    return { ok: false, error: 'No workspaces yet. Run "openrun init" in your repository first.' }
  }

  // Relative paths have the same meaning as in the shell. Names and branches
  // without a leading dot still use the name matching below.
  let pathHint = hint
  if (hint.startsWith('/')) pathHint = normalizePath(hint)
  else if (/^(\.{1,2})(\/|$)/.test(hint)) pathHint = normalizePath(`${cwd}/${hint}`)
  const needle = fold(hint)
  if (needle) {
    const byPath = live
      .filter((w) => contains(w.path, pathHint.replace(/\/+$/, '')))
      .sort(byPathDepth)
    if (byPath.length > 0) return { ok: true, value: byPath[0]! }

    const byName = live.filter(
      (w) =>
        fold(w.id) === needle ||
        fold(w.name) === needle ||
        fold(w.branch) === needle ||
        fold(w.projectName ?? '') === needle,
    )
    if (byName.length === 1) return { ok: true, value: byName[0]! }
    if (byName.length > 1) return { ok: false, error: ambiguous(hint, byName) }

    const loose = live.filter(
      (w) => fold(w.name).includes(needle) || fold(w.projectName ?? '').includes(needle),
    )
    if (loose.length === 1) return { ok: true, value: loose[0]! }
    if (loose.length > 1) return { ok: false, error: ambiguous(hint, loose) }

    return { ok: false, error: `No workspace matches "${hint}".\n${optionList(live)}` }
  }

  const here = live
    .filter((w) => contains(w.path, cwd) && (!root || contains(root, w.path)))
    .sort(byPathDepth)
  if (here.length > 0) return { ok: true, value: here[0]! }
  return {
    ok: false,
    error: `Not inside a known workspace. Run "openrun init" here, or add "in <project>" or "in <path>".\n${optionList(live)}`,
  }
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

function label(workspace: WorkspaceChoice): string {
  const project = workspace.projectName ? `${workspace.projectName} · ` : ''
  return `${project}${workspace.branch || workspace.name}`
}

function ambiguous(hint: string, matches: readonly WorkspaceChoice[]): string {
  return `"${hint}" matches ${matches.length} workspaces.\n${optionList(matches)}`
}

function optionList(workspaces: readonly WorkspaceChoice[]): string {
  return workspaces.map((w) => `  ${label(w)}  ${w.path}`).join('\n')
}

/**
 * Why this workspace cannot take an unattended automation right now.
 *
 * Deliberately only the conditions the CLI can see in a list row. The
 * authoritative refusals live on the server write path — `upsertTask` runs the
 * unattended gate and throws its words, which the CLI prints as-is.
 */
export function workspaceScheduleWarning(workspace: WorkspaceChoice): string | null {
  if (workspace.status && workspace.status !== 'ready') {
    return `${label(workspace)} is "${workspace.status}", not ready.`
  }
  if (workspace.activeRunId) {
    return `${label(workspace)} has a run in progress; a fire that overlaps it will queue.`
  }
  return null
}

/**
 * Warn when the line asked for a pull request but the runtime is not allowed
 * to open one.
 *
 * `canOpenPrs` is a per-runtime capability, not a per-automation one: it is
 * what appends the branch/commit/push/`gh pr create` instruction to the prompt
 * (see `prCapability.ts`). The CLI still sets `requireGhAuth` on the
 * automation, so the schedule refuses to arm without a working `gh` login —
 * but without the capability the agent is never told it may ship, so say so
 * rather than letting the run end with an unpushed branch.
 */
export function prCapabilityWarning(
  runtime: RuntimeChoice,
  openPr: boolean,
  suppress = false,
): string | null {
  if (!openPr || suppress || truthy(runtime.canOpenPrs)) return null
  return `${runtime.label || runtime.bin} does not have "May open pull requests" enabled. The prompt asks for one; enable the capability on the Runtimes page so the agent is told it may push.`
}

/** The fields of a `tasks.list` row this module reads. */
export type TaskChoice = {
  id: string
  name: string
  enabled?: number | boolean
}

/**
 * Find the automation a CLI argument names.
 *
 * Exact id first, so a script can round-trip the id it was given; then an exact
 * name, then a unique substring, because typing `openrun now nightly` is the
 * whole point of naming automations. Two matches refuse and list both — firing
 * the wrong automation is not recoverable by pressing Ctrl-C.
 */
export function resolveTask(hint: string, tasks: readonly TaskChoice[]): Resolved<TaskChoice> {
  const needle = fold(hint)
  if (!needle) return { ok: false, error: 'Which automation? Pass a name or an id.' }
  if (tasks.length === 0) return { ok: false, error: 'No automations yet.' }

  const byId = tasks.find((t) => t.id === hint)
  if (byId) return { ok: true, value: byId }
  const exact = tasks.filter((t) => fold(t.name) === needle)
  if (exact.length === 1) return { ok: true, value: exact[0]! }
  if (exact.length > 1) return { ok: false, error: taskAmbiguity(hint, exact) }

  const loose = tasks.filter((t) => fold(t.name).includes(needle))
  if (loose.length === 1) return { ok: true, value: loose[0]! }
  if (loose.length > 1) return { ok: false, error: taskAmbiguity(hint, loose) }

  return {
    ok: false,
    error: `No automation matches "${hint}".\n${tasks.map((t) => `  ${t.name}`).join('\n')}`,
  }
}

function taskAmbiguity(hint: string, matches: readonly TaskChoice[]): string {
  return `"${hint}" matches ${matches.length} automations.\n${matches
    .map((t) => `  ${t.name}  (${t.id})`)
    .join('\n')}`
}
