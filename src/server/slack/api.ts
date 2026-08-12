/**
 * Slack Web API client.
 *
 * Deliberately `fetch` and nothing else — no `@slack/web-api`, no Bolt. The
 * whole app ships four runtime dependencies; adding a Slack SDK to call six
 * JSON endpoints would be the largest dependency in the tree.
 *
 * Slack signals failure *inside* a 200 body (`{ok: false, error: "..."}`), so
 * every call goes through `slackApi` which turns that into a thrown Error.
 */
import type { SlackBlock } from '../../lib/slack/blocks.ts'

const SLACK_API = 'https://slack.com/api'
const TIMEOUT_MS = 10_000

export type SlackApiResponse = { ok: boolean; error?: string; [key: string]: unknown }

export async function slackApi<T extends SlackApiResponse>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (!token) throw new Error('Slack is not connected (no token).')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    const reason = (error as Error)?.name === 'AbortError' ? 'timed out' : (error as Error).message
    throw new Error(`Slack ${method} failed: ${reason}`)
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new Error(`Slack ${method} failed: HTTP ${response.status}`)
  }

  const json = (await response.json()) as T
  if (!json.ok) throw new Error(`Slack ${method} failed: ${json.error ?? 'unknown error'}`)
  return json
}

export type AuthTestResult = { botUserId: string; teamName: string; teamId: string }

export async function authTest(token: string): Promise<AuthTestResult> {
  const json = await slackApi(token, 'auth.test')
  return {
    botUserId: String(json.user_id ?? ''),
    teamName: String(json.team ?? ''),
    teamId: String(json.team_id ?? ''),
  }
}

export type PostMessageInput = {
  channel: string
  text: string
  blocks?: SlackBlock[]
  /** Post into an existing thread rather than the channel. */
  threadTs?: string
}

export type PostMessageResult = { ts: string; channel: string }

export async function postMessage(
  token: string,
  input: PostMessageInput,
): Promise<PostMessageResult> {
  const json = await slackApi(token, 'chat.postMessage', {
    channel: input.channel,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  })
  return { ts: String(json.ts ?? ''), channel: String(json.channel ?? input.channel) }
}

export async function updateMessage(
  token: string,
  input: { channel: string; ts: string; text: string; blocks?: SlackBlock[] },
): Promise<void> {
  await slackApi(token, 'chat.update', {
    channel: input.channel,
    ts: input.ts,
    text: input.text,
    ...(input.blocks ? { blocks: input.blocks } : {}),
  })
}

/**
 * Reply to an interaction using the payload's `response_url`.
 *
 * This is the only Slack write that does not need the bot token — the URL is
 * itself the capability, and it works for 30 minutes after the click.
 */
export async function respondToInteraction(
  responseUrl: string,
  body: { text: string; blocks?: SlackBlock[]; replaceOriginal?: boolean; ephemeral?: boolean },
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: body.text,
        ...(body.blocks ? { blocks: body.blocks } : {}),
        replace_original: body.replaceOriginal ?? false,
        response_type: body.ephemeral === false ? 'in_channel' : 'ephemeral',
      }),
      signal: controller.signal,
    })
  } catch {
    // A dropped ack must never take the run down with it.
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Emoji acknowledgement — the cheapest possible "I heard you" on a phone,
 * shown while a command is still being worked on.
 */
export async function addReaction(
  token: string,
  input: { channel: string; ts: string; name: string },
): Promise<void> {
  try {
    await slackApi(token, 'reactions.add', {
      channel: input.channel,
      timestamp: input.ts,
      name: input.name,
    })
  } catch {
    // `already_reacted` and missing scopes are both harmless here.
  }
}

/** Open a Socket Mode websocket URL using the app-level (`xapp-`) token. */
export async function openSocketConnection(appToken: string): Promise<string> {
  const json = await slackApi(appToken, 'apps.connections.open')
  const url = String(json.url ?? '')
  if (!url) throw new Error('Slack returned no Socket Mode URL')
  return url
}
