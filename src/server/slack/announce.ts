/**
 * Outbound: run events → Slack.
 *
 * Two things get pushed without being asked for, because both are useless if
 * you have to go looking for them:
 *
 *   - a run finishing, so the phone learns the outcome; and
 *   - a supervised tool approval, which **auto-denies after five minutes** —
 *     a notification that arrives late is the same as no notification.
 *
 * Announcements are fire-and-forget in the same spirit as `server/notify.ts`:
 * a Slack outage must never hold up, or throw into, a run's close handler.
 *
 * This module is also where queued turns are flushed. A message typed while the
 * run was busy is sent the moment the run settles, which is what makes
 * "steering" from a phone actually feel like steering.
 */
import {
  approvalBlocks,
  fallbackText,
  runFinishedBlocks,
  type RunView,
} from '../../lib/slack/blocks.ts'
import { subscribeActivityLive } from '../activityLive.ts'
import { subscribeRunLive } from '../runLive.ts'
import { getDb, type RunRow } from '../db.ts'
import { postMessage } from './api.ts'
import { appBaseUrl, getSlackSettings } from './settings.ts'
import { bindThread, threadForRun } from './threads.ts'
import { drainQueued, mergeQueued } from './pendingTurns.ts'
import { pendingApprovalFor } from './dispatch.ts'

function log(message: string) {
  console.log(`[slack] ${message}`)
}

/** Where a run's messages belong: its own thread, else the default channel. */
function destinationFor(runId: string): { channel: string; threadTs?: string } | null {
  const settings = getSlackSettings()
  const bound = threadForRun(runId)
  if (bound?.channelId) return { channel: bound.channelId, threadTs: bound.threadTs }
  if (settings.channelId) return { channel: settings.channelId }
  return null
}

function runRow(runId: string): RunRow | undefined {
  return getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
}

function viewFor(run: RunRow, changedFiles?: number): RunView {
  const runtime = getDb()
    .prepare('SELECT label FROM runtimes WHERE id = ?')
    .get(run.runtimeId) as { label: string } | undefined
  return {
    id: run.id,
    ordinal: 0,
    taskName: run.taskName,
    status: run.status,
    verdict: run.verdict || undefined,
    runtimeId: run.runtimeId,
    runtimeLabel: runtime?.label,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    changedFiles,
  }
}

// ---------------------------------------------------------------------------
// Run finished
// ---------------------------------------------------------------------------

/**
 * Called from core's run-finalized hook. Never throws.
 *
 * Ordering matters: queued turns are flushed *after* the announcement so the
 * thread reads in the order things happened — "finished", then "sending your
 * queued message".
 */
export function onSlackRunFinalized(runId: string, changedFiles: number): void {
  const settings = getSlackSettings()
  if (!settings.enabled || !settings.botToken) return

  // Deferred out of the executor's close handler: flushing a queued turn calls
  // sendFollowUp, which re-enters the executor and would otherwise run inside
  // the very handler that is finalizing this run.
  setImmediate(() => {
    void announceRunFinished(runId, changedFiles)
      .catch((error) => log(`announce failed: ${(error as Error).message}`))
      .finally(() => {
        void flushQueuedTurns(runId).catch((error) =>
          log(`flush failed: ${(error as Error).message}`),
        )
      })
  })
}

async function announceRunFinished(runId: string, changedFiles: number): Promise<void> {
  const settings = getSlackSettings()
  if (!settings.notifyOnFinish) return

  const run = runRow(runId)
  if (!run) return

  const destination = destinationFor(runId)
  if (!destination) return

  const view = viewFor(run, changedFiles)
  const text = `${run.taskName || runId} ${run.status}`
  const posted = await postMessage(settings.botToken, {
    channel: destination.channel,
    text: fallbackText(text),
    blocks: runFinishedBlocks(view, { baseUrl: appBaseUrl() }),
    threadTs: destination.threadTs,
  })

  // A run announced straight into the channel now owns that message as its
  // thread, so replying to it steers the run.
  if (!destination.threadTs && posted.ts) {
    bindThread({ channelId: posted.channel, threadTs: posted.ts, runId })
  }
}

/** Send whatever was typed at this run while it was busy. */
async function flushQueuedTurns(runId: string): Promise<void> {
  const rows = drainQueued(runId)
  if (rows.length === 0) return

  const prompt = mergeQueued(rows)
  if (!prompt) return

  const settings = getSlackSettings()
  const destination = destinationFor(runId)
  const core = await import('../core.ts')

  try {
    core.postMessage({ runId, prompt })
    if (destination) {
      await postMessage(settings.botToken, {
        channel: destination.channel,
        text: 'Sending your queued message',
        blocks: [
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `:paperclip: Sent ${rows.length} queued message${rows.length === 1 ? '' : 's'} as the next turn.`,
              },
            ],
          },
        ],
        threadTs: destination.threadTs,
      })
    }
  } catch (error) {
    // The queue was already drained, so say why rather than retrying forever.
    const reason = (error as Error).message
    log(`queued turn refused: ${reason}`)
    if (destination) {
      await postMessage(settings.botToken, {
        channel: destination.channel,
        text: 'Queued message could not be sent',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:warning: Could not send your queued message: ${reason}\n\n>${prompt.slice(0, 500)}`,
            },
          },
        ],
        threadTs: destination.threadTs,
      }).catch(() => undefined)
    }
  }
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

type WatcherState = {
  started: boolean
  unsubscribeActivity: (() => void) | null
  /** runId → unsubscribe, one per run we are tailing for approval prompts. */
  runs: Map<string, () => void>
  /** requestIds already posted, so a re-render never double-pings. */
  announced: Set<string>
}

const GLOBAL_KEY = '__agentops_slack_watchers__'

function watchers(): WatcherState {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      started: false,
      unsubscribeActivity: null,
      runs: new Map<string, () => void>(),
      announced: new Set<string>(),
    } satisfies WatcherState
  }
  return g[GLOBAL_KEY] as WatcherState
}

/**
 * Watch running runs for approval prompts.
 *
 * `runLive` is per-run, so we use the app-wide activity stream to learn which
 * runs exist and tail only those. Singleton-guarded on `globalThis` like the
 * other live registries, so HMR cannot leave two tails on one run.
 */
export function startSlackWatchers(): void {
  const w = watchers()
  if (w.started) return
  w.started = true

  w.unsubscribeActivity = subscribeActivityLive((event) => {
    if (event.type !== 'run_changed') return
    if (event.status === 'running') watchRun(event.runId)
    else unwatchRun(event.runId)
  })
}

export function stopSlackWatchers(): void {
  const w = watchers()
  w.unsubscribeActivity?.()
  w.unsubscribeActivity = null
  for (const unsubscribe of w.runs.values()) unsubscribe()
  w.runs.clear()
  w.started = false
}

function watchRun(runId: string): void {
  const w = watchers()
  if (w.runs.has(runId)) return
  // Don't tail runs at all while Slack is off — the watcher stays armed so
  // toggling it back on takes effect without restarting the app.
  const settings = getSlackSettings()
  if (!settings.enabled || !settings.notifyOnApproval) return

  const unsubscribe = subscribeRunLive(runId, (event) => {
    if (event.type !== 'turn_event') return
    if (event.kind !== 'approval_request') return
    const requestId = (event.payload as { requestId?: string })?.requestId
    if (!requestId || w.announced.has(requestId)) return
    w.announced.add(requestId)
    void announceApproval(runId, requestId).catch((error) =>
      log(`approval announce failed: ${(error as Error).message}`),
    )
  })

  w.runs.set(runId, unsubscribe)
}

function unwatchRun(runId: string): void {
  const w = watchers()
  const unsubscribe = w.runs.get(runId)
  if (!unsubscribe) return
  unsubscribe()
  w.runs.delete(runId)
}

async function announceApproval(runId: string, requestId: string): Promise<void> {
  const settings = getSlackSettings()
  if (!settings.enabled || !settings.botToken || !settings.notifyOnApproval) return

  const pending = pendingApprovalFor(runId)
  // Already answered on the desktop between the event and this call.
  if (!pending || pending.requestId !== requestId) return

  const run = runRow(runId)
  if (!run) return

  const destination = destinationFor(runId)
  if (!destination) return

  const posted = await postMessage(settings.botToken, {
    channel: destination.channel,
    text: fallbackText(`${run.taskName || runId} wants to run ${pending.toolName || 'a tool'}`),
    blocks: approvalBlocks(
      {
        runId,
        requestId: pending.requestId,
        taskName: run.taskName,
        toolName: pending.toolName,
        detail: pending.detail,
        options: pending.options,
      },
      appBaseUrl(),
    ),
    threadTs: destination.threadTs,
  })

  if (!destination.threadTs && posted.ts) {
    bindThread({ channelId: posted.channel, threadTs: posted.ts, runId })
  }
}
