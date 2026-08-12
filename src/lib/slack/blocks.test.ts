import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  approvalBlocks,
  automationsBlocks,
  fallbackText,
  runDetailBlocks,
  runsBlocks,
  type RunView,
  type SlackBlock,
  type TaskView,
} from './blocks.ts'
import { SLACK_ACTIONS } from './types.ts'

const NOW = 1_000_000_000_000
const baseUrl = 'http://localhost:3000/'

const runs: RunView[] = [
  {
    id: 'run_aaa111',
    ordinal: 1,
    taskName: 'nightly docs',
    status: 'running',
    startedAt: NOW - 120_000,
    finishedAt: null,
  },
  {
    id: 'run_bbb222',
    ordinal: 2,
    taskName: 'flaky test hunt',
    status: 'success',
    startedAt: NOW - 600_000,
    finishedAt: NOW - 300_000,
  },
]

/** Collect every button in a block list so assertions stay readable. */
function buttonsOf(blocks: SlackBlock[]): Array<Record<string, unknown>> {
  return blocks
    .filter((b) => b.type === 'actions')
    .flatMap((b) => (b.elements as Array<Record<string, unknown>>) ?? [])
}

function textOf(blocks: SlackBlock[]): string {
  return JSON.stringify(blocks)
}

test('a run list numbers every row so `cancel #2` needs no scrolling', () => {
  const blocks = runsBlocks(runs, { baseUrl, now: NOW })
  const text = textOf(blocks)
  assert.match(text, /\*#1\*/)
  assert.match(text, /\*#2\*/)
})

test('only running rows get a cancel button', () => {
  const buttons = buttonsOf(runsBlocks(runs, { baseUrl, now: NOW }))
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0].action_id, SLACK_ACTIONS.cancelRun)
  assert.equal(buttons[0].value, 'run_aaa111')
})

test('cancelling asks for confirmation before killing a process', () => {
  const [cancel] = buttonsOf(runsBlocks(runs, { baseUrl, now: NOW }))
  assert.ok(cancel.confirm, 'cancel button should carry a confirm dialog')
})

test('an empty run list says so instead of rendering an empty card', () => {
  const blocks = runsBlocks([], { baseUrl, emptyText: 'Nothing running.' })
  assert.match(textOf(blocks), /Nothing running\./)
  assert.equal(buttonsOf(blocks).length, 0)
})

test('a run list never exceeds Slack’s five-button ceiling', () => {
  const many: RunView[] = Array.from({ length: 9 }, (_, i) => ({
    id: `run_${i}`,
    ordinal: i + 1,
    taskName: `task ${i}`,
    status: 'running',
    startedAt: NOW - 1000,
    finishedAt: null,
  }))
  assert.equal(buttonsOf(runsBlocks(many, { baseUrl, now: NOW })).length, 5)
})

test('base url trailing slashes do not produce a double slash in links', () => {
  assert.match(textOf(runsBlocks(runs, { baseUrl, now: NOW })), /localhost:3000\/runs\/run_aaa111/)
  assert.doesNotMatch(textOf(runsBlocks(runs, { baseUrl, now: NOW })), /3000\/\/runs/)
})

test('a run detail offers approve and deny only while one is pending', () => {
  const pending = buttonsOf(
    runDetailBlocks(runs[0], { baseUrl, hasPendingApproval: true, now: NOW }),
  ).map((b) => b.action_id)
  assert.ok(pending.includes(SLACK_ACTIONS.approve))
  assert.ok(pending.includes(SLACK_ACTIONS.deny))

  const idle = buttonsOf(runDetailBlocks(runs[0], { baseUrl, now: NOW })).map((b) => b.action_id)
  assert.ok(!idle.includes(SLACK_ACTIONS.approve))
})

test('a finished run detail offers no cancel button', () => {
  const ids = buttonsOf(runDetailBlocks(runs[1], { baseUrl, now: NOW })).map((b) => b.action_id)
  assert.ok(!ids.includes(SLACK_ACTIONS.cancelRun))
  assert.ok(ids.includes(SLACK_ACTIONS.refreshRun))
})

test('a run detail tells you the thread is a composer', () => {
  assert.match(textOf(runDetailBlocks(runs[0], { baseUrl, now: NOW })), /Reply in this thread/)
})

test('an approval carries the request id so a stale button cannot answer a new prompt', () => {
  const blocks = approvalBlocks(
    {
      runId: 'run_aaa111',
      requestId: 'req_9',
      taskName: 'nightly docs',
      toolName: 'Bash',
      detail: 'rm -rf build',
    },
    baseUrl,
  )
  const values = buttonsOf(blocks).map((b) => b.value)
  assert.deepEqual(values, ['run_aaa111::req_9', 'run_aaa111::req_9'])
})

test('an approval prefers the agent’s own option wording', () => {
  const blocks = approvalBlocks(
    {
      runId: 'run_aaa111',
      requestId: 'req_9',
      taskName: 'nightly docs',
      toolName: 'Bash',
      options: [
        { optionId: 'allow-once', name: 'Allow Bash', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
      ],
    },
    baseUrl,
  )
  const buttons = buttonsOf(blocks)
  assert.equal((buttons[0].text as { text: string }).text, 'Allow Bash')
  assert.equal(buttons[0].action_id, SLACK_ACTIONS.approve)
  assert.equal(buttons[0].value, 'run_aaa111::req_9::allow-once')
  assert.equal(buttons[1].action_id, SLACK_ACTIONS.deny)
})

test('an approval warns that silence denies', () => {
  const blocks = approvalBlocks(
    { runId: 'r', requestId: 'q', taskName: 't', toolName: 'Bash' },
    baseUrl,
  )
  assert.match(textOf(blocks), /5 minutes/)
})

test('automations show schedule state and stay numbered', () => {
  const tasks: TaskView[] = [
    { id: 't1', ordinal: 1, name: 'nightly docs', enabled: true, cron: '0 3 * * *', nextRunAt: NOW + 3_600_000 },
    { id: 't2', ordinal: 2, name: 'manual sweep', enabled: false, cron: '', nextRunAt: null },
  ]
  const text = textOf(automationsBlocks(tasks, { baseUrl, now: NOW }))
  assert.match(text, /\*#1\*/)
  assert.match(text, /large_green_circle/)
  assert.match(text, /white_circle/)
  assert.match(text, /manual/)
})

test('automations offer tap-to-run, confirmed, within the button ceiling', () => {
  const many: TaskView[] = Array.from({ length: 8 }, (_, i) => ({
    id: `t${i}`,
    ordinal: i + 1,
    name: `task ${i}`,
    enabled: true,
    cron: '',
    nextRunAt: null,
  }))
  const buttons = buttonsOf(automationsBlocks(many, { baseUrl, now: NOW }))
  assert.equal(buttons.length, 5)
  assert.equal(buttons[0].action_id, SLACK_ACTIONS.runNow)
  assert.equal(buttons[0].value, 't0')
  // Starting a run spawns a real process, so it asks first.
  assert.ok(buttons[0].confirm, 'run-now button should confirm')
})

test('an empty automations list renders no buttons', () => {
  assert.equal(buttonsOf(automationsBlocks([], { baseUrl, now: NOW })).length, 0)
})

test('fallbackText strips mrkdwn for the lock screen', () => {
  assert.equal(fallbackText('*bold* and `code`'), 'bold and code')
})
