/**
 * Slack intent → Open Run action.
 *
 * The transports (Socket Mode, and the HTTP fallback route) both funnel into
 * `dispatchSlackCommand`, so command behaviour is defined exactly once no
 * matter how the message arrived.
 *
 * `core.ts` is imported *lazily*, for the same reason `fns/index.ts` does it:
 * core is the top of the server graph and boots the scheduler on import, while
 * this module is imported by core's own boot path. A static import would be a
 * cycle. Everything below core (executor, db) is imported normally.
 */
import { parseCommand } from '../../lib/slack/commands.ts'
import { slackAuthRefusal } from '../../lib/slack/gate.ts'
import { resolveRunRef, resolveTaskRef, type RunCandidate } from '../../lib/slack/refs.ts'
import {
  automationsBlocks,
  diffBlocks,
  errorBlocks,
  fallbackText,
  helpBlocks,
  logsBlocks,
  noticeBlocks,
  runDetailBlocks,
  runsBlocks,
  statusBlocks,
  type RunView,
  type SlackBlock,
  type TaskView,
} from '../../lib/slack/blocks.ts'
import { escapeMrkdwn } from '../../lib/slack/format.ts'
import type { SlackIntent, SlackSource } from '../../lib/slack/types.ts'
import { listTurnEventsForRun } from '../executor.ts'
import { appBaseUrl, getSlackSettings } from './settings.ts'
import { bindThread, runForThread } from './threads.ts'
import { countQueued, queueTurn } from './pendingTurns.ts'

/** How many runs are addressable by number at any moment. */
const RUN_WINDOW = 25

export type SlackCommandContext = {
  userId: string
  channelId: string
  /** Set when the message arrived inside a thread. */
  threadTs?: string
  /** The message's own ts — becomes the thread root when we reply to it. */
  messageTs?: string
  botId?: string
  source?: SlackSource
}

export type DispatchResult = {
  text: string
  blocks?: SlackBlock[]
  /** Reply into this thread rather than the channel. */
  threadTs?: string
  /** Only the caller sees it (used for refusals and errors). */
  ephemeral?: boolean
}

// ---------------------------------------------------------------------------
// View models — DB rows are mapped here so `lib/slack/blocks.ts` stays pure.
// ---------------------------------------------------------------------------

type Core = typeof import('../core.ts')

const core = (): Promise<Core> => import('../core.ts')

async function runViews(c: Core, limit = RUN_WINDOW): Promise<RunView[]> {
  return c.listRuns({ limit }).map((run, index) => ({
    id: run.id,
    ordinal: index + 1,
    taskName: run.taskName,
    status: run.status,
    verdict: run.verdict || undefined,
    runtimeId: run.runtimeId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }))
}

function runCandidates(views: readonly RunView[]): RunCandidate[] {
  return views.map((v) => ({
    id: v.id,
    ordinal: v.ordinal,
    taskName: v.taskName,
    status: v.status,
  }))
}

async function taskViews(c: Core): Promise<TaskView[]> {
  return c.listTasks().map((task, index) => ({
    id: task.id,
    ordinal: index + 1,
    name: task.name,
    enabled: !!task.enabled,
    cron: task.cron,
    nextRunAt: task.nextRunAt ?? null,
    runtimeId: task.runtimeId,
    queuedCount: task.queuedCount,
  }))
}

/**
 * The approval a supervised run is currently blocked on.
 *
 * Derived from the append-only turn-event log rather than executor memory, so
 * it survives an HMR reload and is the same source the chat UI reads. Payload
 * fields are all optional by design — treat a row missing `requestId` as noise.
 */
export function pendingApprovalFor(runId: string): {
  requestId: string
  toolName: string
  detail: string
  options: Array<{ optionId: string; name: string; kind: string }>
} | null {
  const resolved = new Set<string>()
  let latest: {
    requestId: string
    toolName: string
    detail: string
    options: Array<{ optionId: string; name: string; kind: string }>
  } | null = null

  for (const event of listTurnEventsForRun(runId)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(event.payload) as Record<string, unknown>
    } catch {
      continue
    }
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : ''
    if (!requestId) continue

    if (event.kind === 'approval_resolved') {
      resolved.add(requestId)
    } else if (event.kind === 'approval_request') {
      latest = {
        requestId,
        toolName: typeof payload.name === 'string' ? payload.name : '',
        detail: typeof payload.title === 'string' ? payload.title : '',
        options: Array.isArray(payload.options)
          ? (payload.options as Array<{ optionId: string; name: string; kind: string }>)
          : [],
      }
    }
  }

  if (!latest || resolved.has(latest.requestId)) return null
  return latest
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchSlackCommand(
  text: string,
  ctx: SlackCommandContext,
): Promise<DispatchResult> {
  const settings = getSlackSettings()

  const refusal = slackAuthRefusal({
    userId: ctx.userId,
    botId: ctx.botId,
    channelId: ctx.channelId,
    settings,
  })
  if (refusal) {
    return { text: refusal, blocks: errorBlocks(refusal), ephemeral: true, threadTs: ctx.threadTs }
  }

  // A message inside a bound thread inherits that thread's run, which is what
  // lets a bare reply become the next turn.
  const threadRunId = ctx.threadTs ? runForThread(ctx.channelId, ctx.threadTs) : undefined
  const intent = parseCommand({ text, threadRunId, source: ctx.source })

  try {
    return await runIntent(intent, ctx)
  } catch (error) {
    const message = (error as Error)?.message ?? 'Something went wrong.'
    return {
      text: message,
      blocks: errorBlocks(escapeMrkdwn(message)),
      ephemeral: true,
      threadTs: ctx.threadTs,
    }
  }
}

async function runIntent(intent: SlackIntent, ctx: SlackCommandContext): Promise<DispatchResult> {
  const c = await core()
  const baseUrl = appBaseUrl()
  const thread = ctx.threadTs

  switch (intent.kind) {
    case 'help':
      return reply(helpBlocks(), 'Open Run commands', { threadTs: thread, ephemeral: true })

    case 'unknown':
      return reply(
        [...errorBlocks(`I don’t know \`${escapeMrkdwn(intent.input)}\`.`), ...helpBlocks()],
        'Unknown command',
        { threadTs: thread, ephemeral: true },
      )

    case 'needs_ref':
      return reply(
        errorBlocks(`\`${intent.verb}\` needs a target — try \`${intent.hint}\`.`),
        'Missing target',
        { threadTs: thread, ephemeral: true },
      )

    case 'status': {
      const { stats } = c.getDashboard()
      return reply(
        statusBlocks(
          {
            running: stats.running,
            queued: stats.queued,
            needsAttention: stats.needsAttention,
            runsToday: stats.runsToday,
            successRate: stats.successRate,
            enabledTasks: stats.enabledTasks,
            totalTasks: stats.totalTasks,
          },
          baseUrl,
        ),
        `${stats.running} running, ${stats.runsToday} runs today`,
        { threadTs: thread },
      )
    }

    case 'runs': {
      const all = await runViews(c)
      const filtered = filterRuns(all, intent.filter).slice(0, intent.limit)
      const empty =
        intent.filter === 'active'
          ? 'Nothing is running right now. Try `runs all`.'
          : intent.filter === 'failed'
            ? 'Nothing has failed recently. :tada:'
            : 'No runs yet.'
      return reply(runsBlocks(filtered, { baseUrl, emptyText: empty }), `${filtered.length} runs`, {
        threadTs: thread,
      })
    }

    case 'automations': {
      const tasks = await taskViews(c)
      return reply(automationsBlocks(tasks, { baseUrl }), `${tasks.length} automations`, {
        threadTs: thread,
      })
    }

    case 'run_detail':
    case 'logs':
    case 'diff':
    case 'cancel':
    case 'say':
    case 'approve': {
      const views = await runViews(c)
      const resolved = resolveRunRef(intent.ref, runCandidates(views))
      if (!resolved.ok) {
        return reply(errorBlocks(resolved.reason), 'Could not find that run', {
          threadTs: thread,
          ephemeral: true,
        })
      }
      const runId = resolved.value
      const view = views.find((v) => v.id === runId)
      return runAction(intent, runId, view, ctx, c, baseUrl)
    }

    case 'run_now': {
      const tasks = await taskViews(c)
      const resolved = resolveTaskRef(intent.ref, tasks)
      if (!resolved.ok) {
        return reply(errorBlocks(resolved.reason), 'Could not find that automation', {
          threadTs: thread,
          ephemeral: true,
        })
      }
      const task = tasks.find((t) => t.id === resolved.value)!
      const started = c.runTaskNow(resolved.value)
      const name = escapeMrkdwn(task.name)

      // Bind the new run to this thread so replies steer it immediately.
      const rootTs = ctx.threadTs ?? ctx.messageTs
      if (started.runId && rootTs) {
        bindThread({ channelId: ctx.channelId, threadTs: rootTs, runId: started.runId })
      }
      return reply(
        noticeBlocks(`:rocket: Started *${name}*. Reply here to steer it.`),
        `Started ${task.name}`,
        { threadTs: rootTs },
      )
    }

    case 'set_enabled': {
      const tasks = await taskViews(c)
      const resolved = resolveTaskRef(intent.ref, tasks)
      if (!resolved.ok) {
        return reply(errorBlocks(resolved.reason), 'Could not find that automation', {
          threadTs: thread,
          ephemeral: true,
        })
      }
      const task = tasks.find((t) => t.id === resolved.value)!
      c.setTaskEnabled(resolved.value, intent.enabled)
      const name = escapeMrkdwn(task.name)
      return reply(
        noticeBlocks(
          intent.enabled
            ? `:large_green_circle: *${name}* is enabled.`
            : `:white_circle: *${name}* is paused.`,
        ),
        `${task.name} ${intent.enabled ? 'enabled' : 'paused'}`,
        { threadTs: thread },
      )
    }
  }
}

/** Everything that needs a resolved run id. */
async function runAction(
  intent: Extract<
    SlackIntent,
    { kind: 'run_detail' | 'logs' | 'diff' | 'cancel' | 'say' | 'approve' }
  >,
  runId: string,
  view: RunView | undefined,
  ctx: SlackCommandContext,
  c: Core,
  baseUrl: string,
): Promise<DispatchResult> {
  const thread = ctx.threadTs
  const ordinal = view?.ordinal

  switch (intent.kind) {
    case 'run_detail': {
      const detail = detailFor(c, runId, view, baseUrl)
      // Opening a run from the channel starts a thread you can then talk into.
      const rootTs = ctx.threadTs ?? ctx.messageTs
      if (rootTs) bindThread({ channelId: ctx.channelId, threadTs: rootTs, runId })
      return reply(detail.blocks, detail.text, { threadTs: rootTs })
    }

    case 'logs': {
      const run = c.getRun(runId)
      const tail = [run?.stdout ?? '', run?.stderr ?? ''].filter(Boolean).join('\n')
      return reply(logsBlocks(runId, tail, ordinal), `Output for run ${ordinal ?? runId}`, {
        threadTs: thread,
      })
    }

    case 'diff': {
      const workspace = c.getRunWorkspace(runId)
      const files = (workspace?.files ?? []).map((f) => ({
        path: f.path,
        added: f.additions,
        removed: f.deletions,
      }))
      return reply(diffBlocks(files, ordinal), `${files.length} files changed`, {
        threadTs: thread,
      })
    }

    case 'cancel': {
      const run = c.getRun(runId)
      if (!run)
        return reply(errorBlocks('That run is gone.'), 'Run not found', {
          threadTs: thread,
          ephemeral: true,
        })
      if (run.status !== 'running') {
        return reply(
          noticeBlocks(`That run already finished (${escapeMrkdwn(run.status)}).`),
          'Already finished',
          { threadTs: thread, ephemeral: true },
        )
      }
      c.cancelRun(runId)
      return reply(
        noticeBlocks(
          `:heavy_multiplication_x: Cancelled *${escapeMrkdwn(run.taskName || runId)}*.`,
        ),
        'Run cancelled',
        { threadTs: thread },
      )
    }

    case 'approve': {
      const pending = pendingApprovalFor(runId)
      if (!pending) {
        return reply(
          noticeBlocks('Nothing is waiting for approval on that run.'),
          'Nothing to approve',
          { threadTs: thread, ephemeral: true },
        )
      }
      const { answered } = c.answerApproval({
        runId,
        requestId: pending.requestId,
        decision: intent.decision,
      })
      if (!answered) {
        return reply(
          noticeBlocks('That approval already timed out or was answered elsewhere.'),
          'Too late',
          { threadTs: thread, ephemeral: true },
        )
      }
      return reply(
        noticeBlocks(
          intent.decision === 'allow'
            ? `:white_check_mark: Allowed *${escapeMrkdwn(pending.toolName || 'the tool call')}*.`
            : `:no_entry: Denied *${escapeMrkdwn(pending.toolName || 'the tool call')}*.`,
        ),
        `Approval ${intent.decision}`,
        { threadTs: thread },
      )
    }

    case 'say': {
      const run = c.getRun(runId)
      if (!run) {
        return reply(errorBlocks('That run is gone.'), 'Run not found', {
          threadTs: thread,
          ephemeral: true,
        })
      }

      // Make sure whatever thread this came from steers the run from now on.
      const rootTs = ctx.threadTs ?? ctx.messageTs
      if (rootTs) bindThread({ channelId: ctx.channelId, threadTs: rootTs, runId })

      if (run.status === 'running') {
        // Don't lose the instruction — hold it and send it when the turn ends.
        const { queued } = queueTurn({
          runId,
          text: intent.text,
          channelId: ctx.channelId,
          threadTs: rootTs,
          userId: ctx.userId,
        })
        return reply(
          noticeBlocks(
            queued === 1
              ? ':writing_hand: Still working — I’ll send that the moment this turn ends.'
              : `:writing_hand: Queued (${queued} messages waiting for this turn to end).`,
          ),
          'Queued for the next turn',
          { threadTs: rootTs },
        )
      }

      c.postMessage({ runId, prompt: intent.text })
      return reply(noticeBlocks(':paperclip: Sent — working on it.'), 'Sent to the run', {
        threadTs: rootTs,
      })
    }
  }
}

function detailFor(
  c: Core,
  runId: string,
  view: RunView | undefined,
  baseUrl: string,
): { blocks: SlackBlock[]; text: string } {
  const run = c.getRun(runId)
  if (!run) return { blocks: errorBlocks('That run is gone.'), text: 'Run not found' }

  const resolved: RunView = view ?? {
    id: run.id,
    ordinal: 0,
    taskName: run.taskName,
    status: run.status,
    verdict: run.verdict || undefined,
    runtimeId: run.runtimeId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  }

  const conversation = c.getConversation(runId)
  const lastAssistant = [...(conversation?.messages ?? [])]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content.trim())

  const checks = (conversation?.checkResults ?? []).map((r) => ({
    name: r.name,
    outcome: r.outcome === 'passed' ? 'pass' : 'fail',
  }))

  const queued = countQueued(runId)
  const blocks = runDetailBlocks(resolved, {
    baseUrl,
    lastMessage: lastAssistant?.content,
    checks,
    hasPendingApproval: !!pendingApprovalFor(runId),
  })
  if (queued > 0) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:writing_hand: ${queued} message(s) queued for when this turn ends.`,
        },
      ],
    })
  }

  return { blocks, text: `${run.taskName || runId} — ${run.status}` }
}

function filterRuns(runs: readonly RunView[], filter: 'active' | 'all' | 'failed'): RunView[] {
  if (filter === 'all') return [...runs]
  if (filter === 'active') {
    return runs.filter((r) => r.status === 'running' || r.status === 'queued')
  }
  const bad = new Set(['failed-checks', 'timeout', 'crashed'])
  return runs.filter(
    (r) => r.status === 'failed' || r.status === 'error' || bad.has(r.verdict ?? ''),
  )
}

function reply(
  blocks: SlackBlock[],
  text: string,
  opts: { threadTs?: string; ephemeral?: boolean } = {},
): DispatchResult {
  return {
    blocks,
    text: fallbackText(text),
    threadTs: opts.threadTs,
    ephemeral: opts.ephemeral,
  }
}
