/**
 * Answers for the tools Open Run offers agents over MCP (`lib/openrunTools.ts`).
 *
 * Runs inside the short-lived server process the agent spawns, not inside the
 * app — so it deliberately reads the database and the worktree directly and
 * never imports `core.ts`, which would boot a second scheduler in a child
 * process. Everything is read-only.
 */
import { parseChecks } from '../lib/checks.ts'
import { NO_RUN_MESSAGE, openrunToolDef } from '../lib/openrunTools.ts'
import { runtimeModeLabel, parseRuntimeMode } from '../lib/runtimeMode.ts'
import { getDb, type RunRow, type TaskRow } from './db.ts'
import { changedFiles } from './git.ts'

export type ToolCallResult = {
  /** Rendered for the agent; MCP clients show this text. */
  text: string
  /** Same answer as data, for clients that read `structuredContent`. */
  data: Record<string, unknown>
  isError?: boolean
}

function runFor(runId: string): RunRow | undefined {
  if (!runId.trim()) return undefined
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
}

function taskFor(taskId: string | null): TaskRow | undefined {
  if (!taskId) return undefined
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined
}

function projectChecks(workspaceId: string): { name: string; command: string }[] {
  if (!workspaceId.trim()) return []
  const row = getDb()
    .prepare(
      `SELECT p.checks AS checks
       FROM workspaces w JOIN projects p ON p.id = w.projectId
       WHERE w.id = ?`,
    )
    .get(workspaceId) as { checks: string } | undefined
  return parseChecks(row?.checks).map((c) => ({ name: c.name, command: c.command }))
}

function errorResult(message: string): ToolCallResult {
  return { text: message, data: { error: message }, isError: true }
}

function lines(entries: [string, string | number | undefined][]): string {
  return entries
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
}

function runContext(run: RunRow): ToolCallResult {
  const task = taskFor(run.taskId)
  const checks = projectChecks(run.workspaceId)
  const data: Record<string, unknown> = {
    runId: run.id,
    automation: run.taskName,
    trigger: run.trigger,
    status: run.status,
    workspace: run.cwd,
    branch: run.baseBranch,
    model: run.model,
    effort: run.effort,
    accessMode: runtimeModeLabel(parseRuntimeMode(run.runtimeMode)),
    verificationChecks: checks,
    ...(task ? { schedule: task.cron, automationPrompt: task.prompt } : {}),
  }
  const text = [
    lines([
      ['Run', run.id],
      ['Automation', run.taskName],
      ['Started by', run.trigger],
      ['Workspace', run.cwd],
      ['Branch', run.baseBranch],
      ['Model', run.model],
      ['Access mode', String(data.accessMode)],
      ['Schedule', task?.cron],
    ]),
    checks.length > 0
      ? `\nVerification checks that will judge this run:\n${checks
          .map((c) => `  - ${c.name}: ${c.command}`)
          .join('\n')}`
      : '\nNo verification checks are configured for this project.',
  ].join('\n')
  return { text, data }
}

function runChangedFiles(run: RunRow): ToolCallResult {
  let files: ReturnType<typeof changedFiles>
  try {
    files = changedFiles(run.cwd, run.baseSnapshot || undefined)
  } catch (err) {
    return errorResult(`Could not read the worktree: ${err instanceof Error ? err.message : err}`)
  }
  const data = {
    base: run.baseSnapshot || null,
    files: files.map((f) => ({
      path: f.path,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    })),
  }
  const text =
    files.length === 0
      ? 'No files have changed since this run started.'
      : files
          .map((f) => `${f.status.padEnd(9)} ${f.path}  +${f.additions}/-${f.deletions}`)
          .join('\n')
  return { text, data }
}

function recentRuns(run: RunRow, limit: number): ToolCallResult {
  if (!run.taskId) {
    return { text: 'This run is a one-off chat, so it has no earlier runs.', data: { runs: [] } }
  }
  const rows = getDb()
    .prepare(
      `SELECT id, status, verdict, startedAt, finishedAt
       FROM runs WHERE taskId = ? AND id != ? ORDER BY startedAt DESC LIMIT ?`,
    )
    .all(run.taskId, run.id, limit) as {
    id: string
    status: string
    verdict: string
    startedAt: number
    finishedAt: number | null
  }[]

  const data = {
    runs: rows.map((r) => ({
      id: r.id,
      status: r.status,
      verdict: r.verdict || null,
      startedAt: new Date(r.startedAt).toISOString(),
      finishedAt: r.finishedAt ? new Date(r.finishedAt).toISOString() : null,
    })),
  }
  const text =
    rows.length === 0
      ? 'This automation has not run before.'
      : rows
          .map((r) => {
            const when = new Date(r.startedAt).toISOString()
            return `${when}  ${r.status}${r.verdict ? ` (${r.verdict})` : ''}`
          })
          .join('\n')
  return { text, data }
}

/** Dispatch one `tools/call`. Unknown names and bad arguments come back as errors. */
export function callOpenrunTool(input: {
  name: string
  args: Record<string, unknown>
  runId: string
}): ToolCallResult {
  if (!openrunToolDef(input.name)) return errorResult(`Unknown tool "${input.name}"`)
  if (!input.runId.trim()) return errorResult(NO_RUN_MESSAGE)

  const run = runFor(input.runId)
  if (!run) return errorResult(`Run ${input.runId} is not in this Open Run database.`)

  if (input.name === 'run_context') return runContext(run)
  if (input.name === 'changed_files') return runChangedFiles(run)
  if (input.name === 'recent_runs') {
    const raw = input.args.limit
    const limit = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 5
    return recentRuns(run, Math.min(Math.max(limit, 1), 20))
  }
  return errorResult(`Tool "${input.name}" has no handler.`)
}
