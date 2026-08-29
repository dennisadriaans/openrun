/**
 * Verification check runner.
 *
 * Runs a project's checks in a run's worktree after an *unattended* agent turn
 * finishes and records one `check_results` row per check. This is what turns
 * "the CLI exited 0" into "the tests are green" — see lib/verdict.ts for how
 * the outcomes are folded into a run verdict. `executor.concludeTurn` decides
 * when a pass is warranted; a human-typed turn never triggers one.
 *
 * Checks run one after another, not in parallel: they share a worktree (and
 * usually a build cache), so overlapping `tsc` and `vitest` runs would trip
 * over each other's output. The first failure short-circuits the rest of the
 * pass — once the verdict is decided, spending another five minutes on the
 * remaining checks helps nobody.
 */
import { spawn } from 'node:child_process'
import { latestPass } from '../lib/checkPass.ts'
import {
  CHECK_OUTPUT_TAIL_CHARS,
  CHECK_TIMEOUT_MS,
  parseChecks,
  type CheckDef,
} from '../lib/checks.ts'
import type { CheckOutcome } from '../lib/verdict.ts'
import { getDb, type CheckResultRow } from './db.ts'
import { killChildTree } from './processControl.ts'
import { publishRunLive } from './runLive.ts'

/**
 * `check_results.blocking` predates the decision that every check gates. The
 * column is NOT NULL and migrations here are additive-only, so rows keep
 * recording 1 and nothing reads it back.
 */
const LEGACY_BLOCKING = 1

function resultId(): string {
  return `cr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Keep the tail — a compiler or test runner puts the useful part last. */
function tail(text: string): string {
  return text.length <= CHECK_OUTPUT_TAIL_CHARS
    ? text
    : `…(truncated)\n${text.slice(-CHECK_OUTPUT_TAIL_CHARS)}`
}

export type CheckRunOutcome = {
  outcome: CheckOutcome
  exitCode: number | null
  output: string
  durationMs: number
}

/**
 * Execute one check command. Never rejects — a spawn failure is reported as a
 * failed check, because "we could not run your test command" is exactly the
 * kind of thing the verdict should be red about.
 */
export function executeCheck(input: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<CheckRunOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let output = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let spawnError = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort = () => {}

    const finish = (outcome: CheckOutcome, exitCode: number | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      resolve({
        outcome,
        exitCode,
        output: tail(output),
        durationMs: Date.now() - startedAt,
      })
    }

    // Do not spawn a check after cancellation. Apart from being cheaper, this
    // closes the small window where an already-aborted signal could otherwise
    // start a process before the abort listener is attached.
    if (input.signal?.aborted) {
      aborted = true
      output = '\n[checks] cancelled\n'
      finish('skipped', null)
      return
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(input.command, {
        cwd: input.cwd,
        shell: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group so a timeout can take down the whole tree. A test
        // runner spawned by `pnpm test` is a grandchild — killing the shell
        // alone would leave it running against the worktree.
        detached: process.platform !== 'win32',
      })
    } catch (err) {
      output += `[checks] failed to start: ${String(err)}\n`
      finish('failed', null)
      return
    }

    const stop = () => {
      killChildTree(child, { stillLive: () => !settled })
    }

    timer = setTimeout(() => {
      timedOut = true
      output += `\n[checks] timed out after ${Math.round(input.timeoutMs / 1000)}s\n`
      stop()
    }, input.timeoutMs)

    onAbort = () => {
      if (settled) return
      output += '\n[checks] cancelled\n'
      aborted = true
      // Do not resolve until the child emits `close`. The caller owns the
      // workspace lock for the whole verification pass; resolving here would
      // let cancellation release that lock while the check process (or one of
      // its grandchildren) is still writing to the worktree.
      stop()
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    // AbortSignal does not invoke a listener added after abort. Re-check after
    // registration so a signal that changed during setup still kills the
    // child and waits for its close event before resolving.
    if (input.signal?.aborted) onAbort()

    const append = (chunk: Buffer) => {
      output += chunk.toString()
      // Bound memory for a check that streams megabytes; the tail is what
      // matters and `tail()` would throw the rest away anyway.
      if (output.length > CHECK_OUTPUT_TAIL_CHARS * 4) {
        output = output.slice(-CHECK_OUTPUT_TAIL_CHARS * 2)
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    child.on('error', (err) => {
      output += `\n[checks] ${err.message}\n`
      // Wait for `close` before settling. An error event can arrive while the
      // child still has output or grandchildren alive; the workspace remains
      // reserved until the process lifecycle has actually ended.
      spawnError = true
    })

    child.on('close', (code) => {
      if (aborted) return finish('skipped', null)
      if (timedOut) return finish('timeout', code)
      if (spawnError) return finish('failed', null)
      finish(code === 0 ? 'passed' : 'failed', code)
    })
  })
}

export type VerificationPass = {
  results: CheckResultRow[]
  /** True when at least one check failed or timed out. */
  failed: boolean
}

/** Checks configured for the project that owns a workspace. */
export function checksForWorkspace(workspaceId: string): CheckDef[] {
  if (!workspaceId.trim()) return []
  const row = getDb()
    .prepare(
      `SELECT p.checks AS checks
       FROM workspaces w JOIN projects p ON p.id = w.projectId
       WHERE w.id = ?`,
    )
    .get(workspaceId) as { checks: string } | undefined
  return parseChecks(row?.checks)
}

function insertResult(row: CheckResultRow) {
  getDb()
    .prepare(
      `INSERT INTO check_results (id, runId, messageId, attempt, checkId, name, command, blocking, outcome, exitCode, output, durationMs, startedAt, finishedAt)
       VALUES (@id, @runId, @messageId, @attempt, @checkId, @name, @command, @blocking, @outcome, @exitCode, @output, @durationMs, @startedAt, @finishedAt)`,
    )
    .run(row)
}

/**
 * Run one verification pass for a run. Results are written (and published)
 * as each check settles, so the run detail page fills in live rather than
 * jumping from "working" to a finished list.
 */
export async function runCheckPass(input: {
  runId: string
  messageId: string
  attempt: number
  cwd: string
  checks: CheckDef[]
  signal?: AbortSignal
}): Promise<VerificationPass> {
  const results: CheckResultRow[] = []
  let failed = false

  for (const def of input.checks) {
    const id = resultId()
    const startedAt = Date.now()

    // Once a check is red the verdict is settled — record the rest as skipped
    // rather than spending their timeouts on a decided outcome.
    if (failed || input.signal?.aborted) {
      const skipped: CheckResultRow = {
        id,
        runId: input.runId,
        messageId: input.messageId,
        attempt: input.attempt,
        checkId: def.id,
        name: def.name,
        command: def.command,
        blocking: LEGACY_BLOCKING,
        outcome: 'skipped',
        exitCode: null,
        output: '',
        durationMs: 0,
        startedAt,
        finishedAt: startedAt,
      }
      insertResult(skipped)
      results.push(skipped)
      publishRunLive(input.runId, { type: 'check_finished', result: skipped })
      continue
    }

    publishRunLive(input.runId, {
      type: 'check_started',
      id,
      runId: input.runId,
      messageId: input.messageId,
      attempt: input.attempt,
      checkId: def.id,
      name: def.name,
      command: def.command,
      startedAt,
    })

    const outcome = await executeCheck({
      command: def.command,
      cwd: input.cwd,
      timeoutMs: CHECK_TIMEOUT_MS,
      signal: input.signal,
    })

    const row: CheckResultRow = {
      id,
      runId: input.runId,
      messageId: input.messageId,
      attempt: input.attempt,
      checkId: def.id,
      name: def.name,
      command: def.command,
      blocking: LEGACY_BLOCKING,
      outcome: outcome.outcome,
      exitCode: outcome.exitCode,
      output: outcome.output,
      durationMs: outcome.durationMs,
      startedAt,
      finishedAt: Date.now(),
    }
    insertResult(row)
    results.push(row)
    publishRunLive(input.runId, { type: 'check_finished', result: row })

    if (outcome.outcome === 'failed' || outcome.outcome === 'timeout') {
      failed = true
    }
  }

  return { results, failed }
}

export function listCheckResults(runId: string): CheckResultRow[] {
  return getDb()
    .prepare('SELECT * FROM check_results WHERE runId = ? ORDER BY attempt ASC, startedAt ASC')
    .all(runId) as CheckResultRow[]
}

/**
 * Results from the most recent pass only — the verdict is about the state the
 * run ended in, not about failures an earlier repair turn already fixed.
 */
export function latestCheckResults(runId: string): CheckResultRow[] {
  return latestPass(listCheckResults(runId))
}

/**
 * Drop a previously recorded pass for one turn/attempt. A manual re-run
 * replaces the pass it repeats rather than stacking a second copy of the same
 * key, which `latestPass` would then read as one pass with doubled rows.
 */
export function clearCheckPass(runId: string, messageId: string, attempt: number): void {
  getDb()
    .prepare('DELETE FROM check_results WHERE runId = ? AND messageId = ? AND attempt = ?')
    .run(runId, messageId, attempt)
}
