/**
 * Ship a verified automation run and see its pull request through CI.
 *
 * The rules live in `@openrun/domain/runs/autoShip`; this module does the IO.
 * The executor calls `shipVerifiedRun` once a scheduled or webhook turn is
 * verified in its own checkout. The first call opens the pull request and
 * starts a watch; a call on a watched run is a repair turn finishing, whose
 * fix is committed and pushed onto the same branch.
 *
 * The watch is a `pr_watches` row, so it survives a restart. It ends when the
 * pull request is green and mergeable, merged, closed, out of repair attempts,
 * or idle too long — and says which in the run's log.
 */
import {
  buildConflictRepairPrompt,
  PR_WATCH_IDLE_LIMIT_MS,
  prReadyMessage,
  prWatchDecision,
} from '@openrun/domain/runs/autoShip'
import { buildCiRepairPrompt } from '@openrun/domain/runs/ciRepair'
import { getDb } from '../storage/db.ts'
import { publishRunLive } from '../events/runLive.ts'
import { getRunEnvironment, usingRunEnvironment } from '../execution/runEnvironment.ts'
import { sendFollowUp } from '../execution/executor.ts'
import { isShuttingDown } from '../process/processControl.ts'
import * as git from '../workspaces/git.ts'
import { invalidateRunPullRequest } from './conversation.ts'
import { shipRun } from './git.ts'

type PrWatchRow = {
  runId: string
  prNumber: number
  prUrl: string
  attempts: number
  repairedSha: string
  activityAt: number
  createdAt: number
}

const WATCH_INTERVAL_MS = 60_000

const REPAIR_COMMIT_MESSAGE = 'fix: address pull request checks'

function getWatch(runId: string): PrWatchRow | undefined {
  return getDb().prepare('SELECT * FROM pr_watches WHERE runId = ?').get(runId) as
    | PrWatchRow
    | undefined
}

function endWatch(runId: string): void {
  getDb().prepare('DELETE FROM pr_watches WHERE runId = ?').run(runId)
  invalidateRunPullRequest(runId)
}

/** Append a line to the run's log, attached to its latest reply. */
function note(runId: string, text: string, messageId?: string): void {
  const db = getDb()
  const chunk = `\n[openrun] ${text}\n`
  db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?').run(chunk, runId)
  const target =
    messageId ??
    (
      db
        .prepare(
          "SELECT id FROM messages WHERE runId = ? AND role = 'assistant' ORDER BY createdAt DESC LIMIT 1",
        )
        .get(runId) as { id: string } | undefined
    )?.id
  if (target) publishRunLive(runId, { type: 'log', stream: 'stderr', chunk, messageId: target })
}

function pullRequestNumber(url: string): number {
  const match = url.match(/\/pull\/(\d+)/)
  return match ? Number(match[1]) : 0
}

/** Called by the executor for a verified scheduled or webhook turn. */
export async function shipVerifiedRun(runId: string, messageId: string): Promise<void> {
  if (getWatch(runId)) {
    await pushRepair(runId, messageId)
    return
  }
  try {
    const shipped = await shipRun({ runId })
    note(runId, `Opened ${shipped.url || 'a pull request'} from ${shipped.branch}.`, messageId)
    const prNumber = pullRequestNumber(shipped.url)
    if (!prNumber) return
    const now = Date.now()
    getDb()
      .prepare(
        'INSERT OR REPLACE INTO pr_watches (runId, prNumber, prUrl, attempts, repairedSha, activityAt, createdAt) VALUES (?, ?, ?, 0, ?, ?, ?)',
      )
      .run(runId, prNumber, shipped.url, '', now, now)
    note(runId, 'Watching its checks; failures and merge conflicts come back here.', messageId)
  } catch (err) {
    note(
      runId,
      `Could not open the pull request: ${err instanceof Error ? err.message : String(err)}`,
      messageId,
    )
  }
}

/** A repair turn passed its checks: land the fix on the pull request's branch. */
async function pushRepair(runId: string, messageId: string): Promise<void> {
  try {
    await usingRunEnvironment(runId, async () => {
      const cwd = getRunEnvironment(runId)?.path
      if (!cwd) throw new Error('The run has no execution checkout')
      if (git.repoInfo(cwd).dirty) git.commit(cwd, REPAIR_COMMIT_MESSAGE)
      // Ours alone, and a conflict repair rebases it; the lease still refuses
      // to replace anything someone else pushed.
      await git.push(cwd, { forceWithLease: true })
    })
    getDb().prepare('UPDATE pr_watches SET activityAt = ? WHERE runId = ?').run(Date.now(), runId)
    invalidateRunPullRequest(runId)
    note(runId, 'Pushed the repair to the pull request.', messageId)
  } catch (err) {
    note(
      runId,
      `Could not push the repair: ${err instanceof Error ? err.message : String(err)}`,
      messageId,
    )
  }
}

async function checkWatch(row: PrWatchRow): Promise<void> {
  const db = getDb()
  const run = db.prepare('SELECT status, taskId, cwd FROM runs WHERE id = ?').get(row.runId) as
    | { status: string; taskId: string | null; cwd: string }
    | undefined
  if (!run) {
    db.prepare('DELETE FROM pr_watches WHERE runId = ?').run(row.runId)
    return
  }
  const task = run.taskId
    ? (db.prepare('SELECT maxRepairAttempts FROM tasks WHERE id = ?').get(run.taskId) as
        | { maxRepairAttempts: number }
        | undefined)
    : undefined

  const cwd = getRunEnvironment(row.runId)?.repoPath ?? run.cwd
  const probe = await git.pullRequestWatchStateAsync(cwd, row.prNumber)
  const sinceActivityMs = Date.now() - row.activityAt
  if (probe.kind === 'error') {
    // A logged-out gh or a network blip is retried; the idle limit still ends
    // a watch that can never read its pull request again.
    if (sinceActivityMs > PR_WATCH_IDLE_LIMIT_MS) {
      note(row.runId, `Stopped watching ${row.prUrl}: ${probe.reason}`)
      endWatch(row.runId)
    }
    return
  }

  const decision = prWatchDecision({
    state: probe.pullRequest.state,
    checks: probe.pullRequest.checks,
    failingChecks: probe.pullRequest.failingChecks,
    mergeable: probe.mergeable,
    headSha: probe.headSha,
    repairedSha: row.repairedSha,
    attemptsUsed: row.attempts,
    maxAttempts: task?.maxRepairAttempts ?? 0,
    busy: run.status === 'running',
    sinceActivityMs,
  })

  if (decision.kind === 'wait') return
  if (decision.kind === 'ready') {
    note(row.runId, prReadyMessage(row.prUrl))
    endWatch(row.runId)
    return
  }
  if (decision.kind === 'stop') {
    note(row.runId, decision.reason)
    endWatch(row.runId)
    return
  }

  const prompt =
    decision.cause === 'ci'
      ? buildCiRepairPrompt({
          prNumber: row.prNumber,
          prUrl: row.prUrl,
          failingChecks: probe.pullRequest.failingChecks,
          executorPushes: true,
        })
      : buildConflictRepairPrompt({
          prNumber: row.prNumber,
          prUrl: row.prUrl,
          baseBranch: probe.baseBranch,
        })
  db.prepare(
    'UPDATE pr_watches SET attempts = attempts + 1, repairedSha = ?, activityAt = ? WHERE runId = ?',
  ).run(probe.headSha, Date.now(), row.runId)
  try {
    sendFollowUp({ runId: row.runId, prompt, internal: true })
    note(
      row.runId,
      decision.cause === 'ci'
        ? `Checks failed on ${row.prUrl}; asked the agent to fix them (attempt ${row.attempts + 1}).`
        : `${row.prUrl} has merge conflicts; asked the agent to rebase (attempt ${row.attempts + 1}).`,
    )
  } catch (err) {
    note(
      row.runId,
      `Could not start a repair turn: ${err instanceof Error ? err.message : String(err)}`,
    )
    endWatch(row.runId)
  }
}

const state = globalThis as unknown as {
  __openrunPrWatchTimer?: ReturnType<typeof setInterval>
  __openrunPrWatchTicking?: boolean
}

/** One pass over every watch. Exported so a test can step the loop. */
export async function checkPrWatches(): Promise<void> {
  if (state.__openrunPrWatchTicking || isShuttingDown()) return
  state.__openrunPrWatchTicking = true
  try {
    const rows = getDb()
      .prepare('SELECT * FROM pr_watches ORDER BY createdAt')
      .all() as PrWatchRow[]
    for (const row of rows) {
      if (isShuttingDown()) return
      try {
        await checkWatch(row)
      } catch (err) {
        console.error(`[autoShip] watch failed for ${row.runId}:`, err)
      }
    }
  } finally {
    state.__openrunPrWatchTicking = false
  }
}

/** Start the watch loop once per process; watches left by a restart resume. */
export function bootPrWatches(): void {
  if (state.__openrunPrWatchTimer) return
  const timer = setInterval(() => void checkPrWatches(), WATCH_INTERVAL_MS)
  timer.unref?.()
  state.__openrunPrWatchTimer = timer
}
