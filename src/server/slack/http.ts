/**
 * HTTP fallback for Slack.
 *
 * Socket Mode is the supported path — it needs no public URL, which is the
 * whole reason it exists here. These handlers are for people who already run a
 * tunnel (Cloudflare / ngrok) for the GitHub / Jira / Linear webhooks and would
 * rather point Slack at the same hostname.
 *
 * Unlike Socket Mode, anything arriving here is unauthenticated until proven
 * otherwise, so every request is signature-checked before it is even parsed as
 * a command.
 */
import { verifySlackRequest } from './signature.ts'
import { getSlackSettings } from './settings.ts'
import { dispatchSlackCommand, type SlackCommandContext } from './dispatch.ts'
import { handleBlockAction } from './interactions.ts'
import { postMessage } from './api.ts'

export type SlackHttpResult = {
  status: number
  /** JSON body, or a bare string for Slack's challenge echo. */
  body: unknown
}

export type SlackHttpInput = {
  rawBody: Buffer
  headers: Headers
}

/** `POST /api/slack/events` — Events API and URL verification. */
export async function handleSlackEventsRequest(
  input: SlackHttpInput,
): Promise<SlackHttpResult> {
  const settings = getSlackSettings()
  const body = input.rawBody.toString('utf8')

  const refusal = verifySlackRequest({
    rawBody: body,
    signingSecret: settings.signingSecret,
    signature: input.headers.get('x-slack-signature'),
    timestamp: input.headers.get('x-slack-request-timestamp'),
  })
  if (refusal) return { status: 401, body: { ok: false, error: refusal } }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return { status: 400, body: { ok: false, error: 'Malformed JSON' } }
  }

  // One-time endpoint check when the app is first pointed at this URL.
  if (payload.type === 'url_verification') {
    return { status: 200, body: { challenge: String(payload.challenge ?? '') } }
  }

  if (!settings.enabled) return { status: 200, body: { ok: true, ignored: 'disabled' } }

  // Slack retries anything it does not hear back about within three seconds,
  // so acknowledge now and answer in the background.
  void handleEventPayload(payload).catch((error) =>
    console.log(`[slack] http event failed: ${(error as Error).message}`),
  )

  return { status: 200, body: { ok: true } }
}

async function handleEventPayload(payload: Record<string, unknown>): Promise<void> {
  const event = (payload.event ?? {}) as Record<string, unknown>
  const type = String(event.type ?? '')
  if ((type !== 'message' && type !== 'app_mention') || event.subtype) return
  if (event.bot_id) return

  const isDm = String(event.channel_type ?? '') === 'im'
  const mentioned = type === 'app_mention'
  const threadTs = event.thread_ts ? String(event.thread_ts) : undefined
  if (!isDm && !mentioned && !threadTs) return

  await respond(String(event.text ?? ''), {
    userId: String(event.user ?? ''),
    channelId: String(event.channel ?? ''),
    threadTs,
    messageTs: String(event.ts ?? ''),
    source: mentioned ? 'mention' : isDm ? 'dm' : 'thread',
  })
}

/**
 * `POST /api/slack/interactions` — button clicks, and slash commands when they
 * are configured over HTTP rather than Socket Mode.
 */
export async function handleSlackInteractionsRequest(
  input: SlackHttpInput,
): Promise<SlackHttpResult> {
  const settings = getSlackSettings()
  const body = input.rawBody.toString('utf8')

  const refusal = verifySlackRequest({
    rawBody: body,
    signingSecret: settings.signingSecret,
    signature: input.headers.get('x-slack-signature'),
    timestamp: input.headers.get('x-slack-request-timestamp'),
  })
  if (refusal) return { status: 401, body: { ok: false, error: refusal } }
  if (!settings.enabled) return { status: 200, body: { ok: true, ignored: 'disabled' } }

  const form = new URLSearchParams(body)

  // Interactive components arrive as a JSON blob inside a form field.
  const raw = form.get('payload')
  if (raw) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return { status: 400, body: { ok: false, error: 'Malformed interaction payload' } }
    }
    void handleBlockAction(payload).catch((error) =>
      console.log(`[slack] http interaction failed: ${(error as Error).message}`),
    )
    return { status: 200, body: { ok: true } }
  }

  // Otherwise it is a slash command.
  const command = form.get('text') ?? ''
  const ctx: SlackCommandContext = {
    userId: form.get('user_id') ?? '',
    channelId: form.get('channel_id') ?? '',
    source: 'slash',
  }
  void respond(command, ctx).catch((error) =>
    console.log(`[slack] http command failed: ${(error as Error).message}`),
  )

  return { status: 200, body: { ok: true } }
}

async function respond(text: string, ctx: SlackCommandContext): Promise<void> {
  const result = await dispatchSlackCommand(text, ctx)
  const settings = getSlackSettings()
  const channel = ctx.channelId || settings.channelId
  if (!channel) return
  await postMessage(settings.botToken, {
    channel,
    text: result.text,
    blocks: result.blocks,
    threadTs: result.threadTs,
  })
}
