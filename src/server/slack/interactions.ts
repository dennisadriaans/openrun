/**
 * Block Kit button handling.
 *
 * Buttons matter more than commands on a phone: approving a tool call or
 * killing a run should be one tap, not a retyped run id. Every payload carries
 * the ids it needs, so a button stays correct even after the message scrolls
 * away — and an approval button carries its `requestId`, so a stale card cannot
 * answer a *newer* prompt by accident.
 *
 * The same authorization gate as text commands applies: a button in a channel
 * is visible to everyone who can see the channel.
 */
import { slackAuthRefusal } from '../../lib/slack/gate.ts'
import { errorBlocks, noticeBlocks } from '../../lib/slack/blocks.ts'
import { escapeMrkdwn } from '../../lib/slack/format.ts'
import { SLACK_ACTIONS } from '../../lib/slack/types.ts'
import { respondToInteraction } from './api.ts'
import { dispatchSlackCommand, pendingApprovalFor } from './dispatch.ts'
import { getSlackSettings } from './settings.ts'

type BlockAction = { action_id?: string; value?: string }

export async function handleBlockAction(payload: Record<string, unknown>): Promise<void> {
  if (String(payload.type ?? '') !== 'block_actions') return

  const user = (payload.user ?? {}) as Record<string, unknown>
  const channel = (payload.channel ?? {}) as Record<string, unknown>
  const message = (payload.message ?? {}) as Record<string, unknown>
  const actions = (payload.actions ?? []) as BlockAction[]
  const action = actions[0]
  if (!action?.action_id) return

  const responseUrl = String(payload.response_url ?? '')
  const userId = String(user.id ?? '')
  const channelId = String(channel.id ?? '')
  // A button inside a thread should answer inside that thread.
  const threadTs = message.thread_ts ? String(message.thread_ts) : String(message.ts ?? '')

  const settings = getSlackSettings()
  const refusal = slackAuthRefusal({ userId, channelId, settings })
  if (refusal) {
    await respondToInteraction(responseUrl, { text: refusal, blocks: errorBlocks(refusal) })
    return
  }

  const value = String(action.value ?? '')

  switch (action.action_id) {
    case SLACK_ACTIONS.approve:
    case SLACK_ACTIONS.deny:
      await answerFromButton({
        actionId: action.action_id,
        value,
        responseUrl,
      })
      return

    case SLACK_ACTIONS.cancelRun:
      await runCommand(`cancel ${value}`, { userId, channelId, threadTs, responseUrl })
      return

    case SLACK_ACTIONS.refreshRun:
      await runCommand(`show ${value}`, { userId, channelId, threadTs, responseUrl })
      return

    case SLACK_ACTIONS.runNow:
      await runCommand(`run now ${value}`, { userId, channelId, threadTs, responseUrl })
      return

    default:
      return
  }
}

/**
 * Approve / deny straight from the card.
 *
 * The button's value pins the exact `requestId` it was rendered for. If the run
 * has since moved on to a different prompt, answering is refused rather than
 * silently applied to the new one.
 */
async function answerFromButton(input: {
  actionId: string
  value: string
  responseUrl: string
}): Promise<void> {
  const [runId, requestId, optionId] = input.value.split('::')
  if (!runId) return

  const decision = input.actionId === SLACK_ACTIONS.approve ? 'allow' : 'deny'
  const core = await import('../core.ts')

  const pending = pendingApprovalFor(runId)
  if (!pending) {
    await respondToInteraction(input.responseUrl, {
      text: 'Nothing is waiting for approval on that run.',
      blocks: noticeBlocks('That approval already timed out or was answered elsewhere.'),
    })
    return
  }
  if (requestId && pending.requestId !== requestId) {
    await respondToInteraction(input.responseUrl, {
      text: 'That prompt is no longer current.',
      blocks: noticeBlocks(
        'That button was for an earlier prompt — the run has moved on. Open the run to see what it is asking now.',
      ),
    })
    return
  }

  const { answered } = core.answerApproval({
    runId,
    requestId: pending.requestId,
    ...(optionId ? { optionId } : { decision }),
  })

  const tool = escapeMrkdwn(pending.toolName || 'the tool call')
  await respondToInteraction(input.responseUrl, {
    text: answered ? `Approval ${decision}` : 'Too late',
    blocks: answered
      ? noticeBlocks(
          decision === 'allow'
            ? `:white_check_mark: Allowed *${tool}*.`
            : `:no_entry: Denied *${tool}*.`,
        )
      : noticeBlocks('That approval already timed out or was answered elsewhere.'),
    ephemeral: false,
  })
}

/** Route a button through the same code path a typed command would take. */
async function runCommand(
  text: string,
  ctx: { userId: string; channelId: string; threadTs: string; responseUrl: string },
): Promise<void> {
  const result = await dispatchSlackCommand(text, {
    userId: ctx.userId,
    channelId: ctx.channelId,
    threadTs: ctx.threadTs || undefined,
    source: 'thread',
  })
  await respondToInteraction(ctx.responseUrl, {
    text: result.text,
    blocks: result.blocks,
    ephemeral: result.ephemeral ?? false,
  })
}
