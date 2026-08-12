/**
 * Slack control surface — server facade.
 *
 * `server/core.ts` reaches Slack only through this module, the same way it
 * reaches integrations through `server/integrations/index.ts`.
 */
export { getSlackSettings, publicSettings, saveSlackSettings, type SlackSettingsInput, type SlackSettingsPublic } from './settings.ts'
export {
  isSlackSocketConnected,
  restartSlackSocket,
  slackConnectionStatus,
  startSlackSocket,
  stopSlackSocket,
} from './socketMode.ts'
export { onSlackRunFinalized, startSlackWatchers, stopSlackWatchers } from './announce.ts'
export { handleSlackEventsRequest, handleSlackInteractionsRequest, type SlackHttpResult } from './http.ts'
export { dispatchSlackCommand, type DispatchResult, type SlackCommandContext } from './dispatch.ts'
export { pruneThreads } from './threads.ts'
export { clearQueued, countQueued } from './pendingTurns.ts'

import { authTest, postMessage } from './api.ts'
import { fallbackText, helpBlocks } from '../../lib/slack/blocks.ts'
import { slackConfigRefusal } from '../../lib/slack/gate.ts'
import { getSlackSettings } from './settings.ts'
import { startSlackSocket, stopSlackSocket } from './socketMode.ts'
import { startSlackWatchers } from './announce.ts'
import { pruneThreads } from './threads.ts'

/**
 * Boot the Slack surface: connect the socket (if configured and enabled) and
 * start watching runs for approval prompts.
 *
 * Safe to call more than once — both halves are singleton-guarded — and it
 * never throws, because a Slack misconfiguration must not stop the app from
 * running automations locally.
 */
export function bootSlack(): void {
  try {
    pruneThreads()
    startSlackWatchers()
    void startSlackSocket().catch((error) =>
      console.log(`[slack] boot failed: ${(error as Error).message}`),
    )
  } catch (error) {
    console.log(`[slack] boot failed: ${(error as Error).message}`)
  }
}

export type SlackTestResult = {
  ok: boolean
  teamName: string
  botUserId: string
  message: string
}

/**
 * Verify the credentials and, when a channel is set, post the help card there.
 *
 * Posting is the real test: `auth.test` passing only proves the token is live,
 * not that the bot was ever invited to the channel it is meant to speak in —
 * which is the single most common reason a fresh install goes quiet.
 */
export async function testSlackConnection(): Promise<SlackTestResult> {
  const settings = getSlackSettings()
  const refusal = slackConfigRefusal(settings)
  if (refusal) return { ok: false, teamName: '', botUserId: '', message: refusal }

  const identity = await authTest(settings.botToken)

  if (!settings.channelId) {
    return {
      ok: true,
      teamName: identity.teamName,
      botUserId: identity.botUserId,
      message: `Connected to ${identity.teamName}. Set a channel to receive run notifications.`,
    }
  }

  await postMessage(settings.botToken, {
    channel: settings.channelId,
    text: fallbackText('Open Run is connected'),
    blocks: helpBlocks(),
  })

  return {
    ok: true,
    teamName: identity.teamName,
    botUserId: identity.botUserId,
    message: `Connected to ${identity.teamName} and posted to the channel.`,
  }
}

/** Apply saved settings to the live connection. */
export async function applySlackSettings(): Promise<void> {
  stopSlackSocket()
  const settings = getSlackSettings()
  if (settings.enabled) await startSlackSocket()
}
