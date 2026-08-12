/**
 * Block Kit rendering (browser-safe, dependency-free).
 *
 * The server maps its DB rows onto the small view models below and this module
 * turns them into blocks — so message layout is unit-testable without SQLite,
 * and `lib/` keeps its no-node-imports rule.
 *
 * Written for a phone held in one hand: lists collapse into a single numbered
 * section instead of one card per row, and the actions that matter (cancel,
 * approve, deny) are buttons rather than commands to retype.
 */
import {
  codeBlock,
  durationLabel,
  escapeMrkdwn,
  relativeTime,
  slackLink,
  statusEmoji,
  truncate,
} from './format.ts'
import { SLACK_HELP_LINES } from './commands.ts'
import { SLACK_ACTIONS } from './types.ts'

/** Slack blocks are structural JSON; we build them, we never introspect them. */
export type SlackBlock = Record<string, unknown>

export type RunView = {
  id: string
  ordinal: number
  taskName: string
  status: string
  verdict?: string
  runtimeId?: string
  startedAt: number | null
  finishedAt: number | null
  changedFiles?: number
}

export type TaskView = {
  id: string
  ordinal: number
  name: string
  enabled: boolean
  cron: string
  nextRunAt: number | null
  runtimeId?: string
  lastStatus?: string
  queuedCount?: number
}

export type StatusView = {
  running: number
  queued: number
  needsAttention: number
  runsToday: number
  successRate: number | null
  enabledTasks: number
  totalTasks: number
}

export type ApprovalView = {
  runId: string
  requestId: string
  taskName: string
  toolName: string
  detail?: string
  options?: Array<{ optionId: string; name: string; kind: string }>
}

/** Slack caps an actions block at five elements. */
const MAX_BUTTONS = 5

// --- primitives ------------------------------------------------------------

export function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: truncate(text, 3000) } }
}

export function context(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: truncate(text, 3000) }] }
}

export function divider(): SlackBlock {
  return { type: 'divider' }
}

export function header(text: string): SlackBlock {
  // Header blocks are plain_text only and hard-capped at 150 characters.
  return { type: 'header', text: { type: 'plain_text', text: truncate(text, 150), emoji: true } }
}

export function button(opts: {
  text: string
  actionId: string
  value: string
  style?: 'primary' | 'danger'
  confirm?: { title: string; text: string; confirmText: string }
}): SlackBlock {
  const block: SlackBlock = {
    type: 'button',
    text: { type: 'plain_text', text: truncate(opts.text, 75), emoji: true },
    action_id: opts.actionId,
    value: opts.value,
  }
  if (opts.style) block.style = opts.style
  if (opts.confirm) {
    block.confirm = {
      title: { type: 'plain_text', text: truncate(opts.confirm.title, 100) },
      text: { type: 'mrkdwn', text: opts.confirm.text },
      confirm: { type: 'plain_text', text: opts.confirm.confirmText },
      deny: { type: 'plain_text', text: 'Never mind' },
    }
  }
  return block
}

export function actions(elements: SlackBlock[]): SlackBlock[] {
  const kept = elements.slice(0, MAX_BUTTONS)
  return kept.length ? [{ type: 'actions', elements: kept }] : []
}

// --- cards -----------------------------------------------------------------

export function helpBlocks(): SlackBlock[] {
  const lines = SLACK_HELP_LINES.map(([cmd, what]) => `\`${cmd}\` — ${what}`).join('\n')
  return [
    section(`*Open Run*\n${lines}`),
    context(
      'Reply in a run’s thread and it becomes the next turn — no command needed. Runs are addressable by the number shown in any list.',
    ),
  ]
}

export function noticeBlocks(text: string): SlackBlock[] {
  return [section(text)]
}

export function errorBlocks(text: string): SlackBlock[] {
  return [section(`:warning: ${text}`)]
}

export function statusBlocks(view: StatusView, baseUrl: string): SlackBlock[] {
  const bits = [
    `*${view.running}* running`,
    `*${view.queued}* queued`,
    `*${view.runsToday}* today`,
  ]
  if (view.successRate !== null) bits.push(`*${view.successRate}%* green`)
  if (view.needsAttention > 0) bits.push(`:warning: *${view.needsAttention}* need attention`)

  return [
    section(`*Open Run* — ${bits.join(' · ')}`),
    context(
      `${view.enabledTasks}/${view.totalTasks} automations enabled · ${slackLink(baseUrl, 'open desktop')}`,
    ),
  ]
}

/** One numbered line per run, so `cancel #2` needs no scrolling back. */
export function runsBlocks(
  runs: readonly RunView[],
  opts: { baseUrl: string; emptyText?: string; now?: number },
): SlackBlock[] {
  if (runs.length === 0) {
    return [section(opts.emptyText ?? 'No runs match that.')]
  }
  const now = opts.now ?? Date.now()

  const lines = runs.map((run) => {
    const age =
      run.status === 'running'
        ? `running ${durationLabel(run.startedAt, null, now)}`
        : relativeTime(run.finishedAt ?? run.startedAt, now)
    const name = escapeMrkdwn(run.taskName || run.id)
    return `*#${run.ordinal}* ${statusEmoji(run.status, run.verdict)} ${slackLink(
      `${trimSlash(opts.baseUrl)}/runs/${run.id}`,
      name,
    )} · ${age}`
  })

  const running = runs.filter((r) => r.status === 'running').slice(0, MAX_BUTTONS)
  const buttons = running.map((run) =>
    button({
      text: `Cancel #${run.ordinal}`,
      actionId: SLACK_ACTIONS.cancelRun,
      value: run.id,
      style: 'danger',
      confirm: {
        title: 'Cancel this run?',
        text: `*${escapeMrkdwn(run.taskName || run.id)}* stops where it is. Work already written to the workspace stays.`,
        confirmText: 'Cancel run',
      },
    }),
  )

  return [section(lines.join('\n')), ...actions(buttons)]
}

export function runDetailBlocks(
  run: RunView,
  extra: {
    baseUrl: string
    lastMessage?: string
    checks?: Array<{ name: string; outcome: string }>
    hasPendingApproval?: boolean
    now?: number
  },
): SlackBlock[] {
  const now = extra.now ?? Date.now()
  const name = escapeMrkdwn(run.taskName || run.id)
  const duration = durationLabel(run.startedAt, run.finishedAt, now)

  const facts = [
    `${statusEmoji(run.status, run.verdict)} *${run.status}*${run.verdict ? ` · ${run.verdict}` : ''}`,
    duration ? `took ${duration}` : '',
    run.runtimeId ? `via \`${escapeMrkdwn(run.runtimeId)}\`` : '',
    typeof run.changedFiles === 'number' ? `${run.changedFiles} file(s) changed` : '',
  ].filter(Boolean)

  const blocks: SlackBlock[] = [
    section(
      `*#${run.ordinal} ${slackLink(`${trimSlash(extra.baseUrl)}/runs/${run.id}`, name)}*\n${facts.join(' · ')}`,
    ),
  ]

  if (extra.checks?.length) {
    const summary = extra.checks
      .map((c) => `${c.outcome === 'pass' ? ':white_check_mark:' : ':x:'} ${escapeMrkdwn(c.name)}`)
      .join('  ')
    blocks.push(context(summary))
  }

  if (extra.lastMessage?.trim()) {
    blocks.push(section(truncate(escapeMrkdwn(extra.lastMessage.trim()), 1200)))
  }

  const buttons: SlackBlock[] = []
  if (extra.hasPendingApproval) {
    buttons.push(
      button({ text: 'Approve', actionId: SLACK_ACTIONS.approve, value: run.id, style: 'primary' }),
      button({ text: 'Deny', actionId: SLACK_ACTIONS.deny, value: run.id, style: 'danger' }),
    )
  }
  if (run.status === 'running') {
    buttons.push(
      button({
        text: 'Cancel',
        actionId: SLACK_ACTIONS.cancelRun,
        value: run.id,
        style: 'danger',
        confirm: {
          title: 'Cancel this run?',
          text: `*${name}* stops where it is.`,
          confirmText: 'Cancel run',
        },
      }),
    )
  }
  buttons.push(button({ text: 'Refresh', actionId: SLACK_ACTIONS.refreshRun, value: run.id }))

  blocks.push(...actions(buttons))
  blocks.push(context('Reply in this thread to send the run another turn.'))
  return blocks
}

export function automationsBlocks(
  tasks: readonly TaskView[],
  opts: { baseUrl: string; now?: number },
): SlackBlock[] {
  if (tasks.length === 0) {
    return [section('No automations yet — create one in the desktop app.')]
  }
  const now = opts.now ?? Date.now()

  const lines = tasks.map((task) => {
    const state = task.enabled ? ':large_green_circle:' : ':white_circle:'
    const schedule = task.cron.trim()
      ? task.nextRunAt
        ? `next ${relativeTime(task.nextRunAt, now).replace(' ago', '')}`
        : `\`${escapeMrkdwn(task.cron)}\``
      : 'manual'
    const queued = task.queuedCount ? ` · ${task.queuedCount} queued` : ''
    return `*#${task.ordinal}* ${state} ${slackLink(
      `${trimSlash(opts.baseUrl)}/tasks/${task.id}`,
      escapeMrkdwn(task.name),
    )} · ${schedule}${queued}`
  })

  // Tap-to-run for the first few; typing `start <name>` still reaches the rest.
  const buttons = tasks.slice(0, MAX_BUTTONS).map((task) =>
    button({
      text: `Start #${task.ordinal}`,
      actionId: SLACK_ACTIONS.runNow,
      value: task.id,
      confirm: {
        title: 'Run this automation?',
        text: `*${escapeMrkdwn(task.name)}* starts immediately on your machine.`,
        confirmText: 'Run now',
      },
    }),
  )

  return [
    section(lines.join('\n')),
    ...actions(buttons),
    context('`start <name>` to run one now · `enable <name>` / `disable <name>` to arm or pause it.'),
  ]
}

export function logsBlocks(runId: string, tail: string, ordinal?: number): SlackBlock[] {
  const label = ordinal ? `#${ordinal}` : runId
  return [section(`*Output — ${label}*`), section(codeBlock(tail || '(no output yet)', 2800))]
}

export function diffBlocks(
  files: ReadonlyArray<{ path: string; added: number; removed: number }>,
  ordinal?: number,
): SlackBlock[] {
  const label = ordinal ? `#${ordinal}` : 'run'
  if (files.length === 0) {
    return [section(`*Changes — ${label}*\nNothing changed in the workspace yet.`)]
  }
  const lines = files
    .slice(0, 40)
    .map((f) => `\`${escapeMrkdwn(f.path)}\`  +${f.added}/-${f.removed}`)
  const more = files.length > 40 ? `\n_…and ${files.length - 40} more_` : ''
  return [section(`*Changes — ${label}*\n${lines.join('\n')}${more}`)]
}

/**
 * A supervised run is blocked on this and auto-denies in five minutes, so the
 * message leads with the tool and puts the buttons first.
 */
export function approvalBlocks(view: ApprovalView, baseUrl: string): SlackBlock[] {
  const name = escapeMrkdwn(view.taskName || view.runId)
  const tool = escapeMrkdwn(view.toolName || 'a tool')

  const blocks: SlackBlock[] = [
    section(
      `:raising_hand: *${slackLink(`${trimSlash(baseUrl)}/runs/${view.runId}`, name)}* wants to run *${tool}*`,
    ),
  ]
  if (view.detail?.trim()) {
    blocks.push(section(codeBlock(view.detail.trim(), 1200)))
  }

  // Prefer the agent's own options so an ACP agent's wording survives; fall
  // back to plain allow/deny when it offered none.
  const offered = (view.options ?? []).slice(0, MAX_BUTTONS)
  const buttons = offered.length
    ? offered.map((opt) =>
        button({
          text: opt.name,
          actionId: opt.kind.startsWith('allow') ? SLACK_ACTIONS.approve : SLACK_ACTIONS.deny,
          value: `${view.runId}::${view.requestId}::${opt.optionId}`,
          style: opt.kind.startsWith('allow') ? 'primary' : 'danger',
        }),
      )
    : [
        button({
          text: 'Allow',
          actionId: SLACK_ACTIONS.approve,
          value: `${view.runId}::${view.requestId}`,
          style: 'primary',
        }),
        button({
          text: 'Deny',
          actionId: SLACK_ACTIONS.deny,
          value: `${view.runId}::${view.requestId}`,
          style: 'danger',
        }),
      ]

  blocks.push(...actions(buttons))
  blocks.push(context('Denies itself in 5 minutes if nobody answers.'))
  return blocks
}

export function runFinishedBlocks(
  run: RunView,
  extra: { baseUrl: string; summary?: string; now?: number },
): SlackBlock[] {
  const now = extra.now ?? Date.now()
  const name = escapeMrkdwn(run.taskName || run.id)
  const duration = durationLabel(run.startedAt, run.finishedAt, now)
  const changed =
    typeof run.changedFiles === 'number' && run.changedFiles > 0
      ? ` · ${run.changedFiles} file(s) changed`
      : ''

  const blocks: SlackBlock[] = [
    section(
      `${statusEmoji(run.status, run.verdict)} *${slackLink(
        `${trimSlash(extra.baseUrl)}/runs/${run.id}`,
        name,
      )}* ${run.status}${run.verdict ? ` (${run.verdict})` : ''}${duration ? ` in ${duration}` : ''}${changed}`,
    ),
  ]
  if (extra.summary?.trim()) {
    blocks.push(section(truncate(escapeMrkdwn(extra.summary.trim()), 1000)))
  }
  blocks.push(context('Reply in this thread to send it another turn.'))
  return blocks
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Notification text. Slack shows this on the lock screen and in the sidebar,
 * so it has to stand alone without the blocks.
 */
export function fallbackText(text: string): string {
  return truncate(text.replace(/[*_`]/g, ''), 200)
}
