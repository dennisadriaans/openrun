/**
 * Socket Mode client.
 *
 * Why Socket Mode rather than the Events API: Open Run runs on a laptop behind
 * NAT, and the whole point of this integration is to reach *that machine* from
 * a phone. Socket Mode dials **out** to Slack over a websocket, so there is no
 * public URL, no tunnel and no inbound port — the same local-first posture as
 * the rest of the app. The HTTP routes exist only for people who already run a
 * tunnel and would rather use it.
 *
 * Node 22 ships a global `WebSocket`, so this needs no dependency at all.
 *
 * Like the scheduler and the live registries, the client is a module singleton
 * guarded on `globalThis` so Vite HMR cannot leave two sockets connected.
 */
import { authTest, openSocketConnection, postMessage } from './api.ts'
import { dispatchSlackCommand, type SlackCommandContext } from './dispatch.ts'
import { getSlackSettings } from './settings.ts'
import { slackConfigRefusal } from '../../lib/slack/gate.ts'
import type { SlackConnectionStatus } from '../../lib/slack/types.ts'
import { handleBlockAction } from './interactions.ts'

type SocketState = {
  socket: WebSocket | null
  connected: boolean
  connecting: boolean
  /** Set while a reconnect is pending so we never stack timers. */
  reconnectTimer: ReturnType<typeof setTimeout> | null
  attempts: number
  botUserId: string
  teamName: string
  lastError: string
  lastConnectedAt: number | null
  /** Envelope ids already handled, so Slack retries are not double-executed. */
  seen: Set<string>
  /** True once stop() is called — suppresses the reconnect loop. */
  stopped: boolean
}

const GLOBAL_KEY = '__agentops_slack_socket__'

function state(): SocketState {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      socket: null,
      connected: false,
      connecting: false,
      reconnectTimer: null,
      attempts: 0,
      botUserId: '',
      teamName: '',
      lastError: '',
      lastConnectedAt: null,
      seen: new Set<string>(),
      stopped: true,
    } satisfies SocketState
  }
  return g[GLOBAL_KEY] as SocketState
}

const MAX_BACKOFF_MS = 60_000
const SEEN_LIMIT = 500

function log(message: string) {
  console.log(`[slack] ${message}`)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Connect if the settings are complete and enabled; otherwise stay down. */
export async function startSlackSocket(): Promise<void> {
  const s = state()
  const settings = getSlackSettings()

  if (!settings.enabled) return
  const refusal = slackConfigRefusal(settings)
  if (refusal) {
    s.lastError = refusal
    return
  }
  if (s.connected || s.connecting) return

  s.stopped = false
  await connect()
}

export function stopSlackSocket(): void {
  const s = state()
  s.stopped = true
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer)
    s.reconnectTimer = null
  }
  try {
    s.socket?.close()
  } catch {
    // Already gone.
  }
  s.socket = null
  s.connected = false
  s.connecting = false
  s.attempts = 0
}

/** Apply changed settings: drop the old socket, then reconnect if still on. */
export async function restartSlackSocket(): Promise<void> {
  stopSlackSocket()
  await startSlackSocket()
}

async function connect(): Promise<void> {
  const s = state()
  if (s.stopped || s.connecting || s.connected) return
  s.connecting = true

  const settings = getSlackSettings()
  try {
    const identity = await authTest(settings.botToken)
    s.botUserId = identity.botUserId
    s.teamName = identity.teamName

    const url = await openSocketConnection(settings.appToken)
    const socket = new WebSocket(url)
    s.socket = socket

    socket.addEventListener('open', () => {
      s.connected = true
      s.connecting = false
      s.attempts = 0
      s.lastError = ''
      s.lastConnectedAt = Date.now()
      log(`connected to ${s.teamName || 'Slack'} as ${s.botUserId}`)
    })

    socket.addEventListener('message', (event) => {
      void onEnvelope(socket, String((event as MessageEvent).data ?? ''))
    })

    socket.addEventListener('error', () => {
      // The close handler does the reconnecting; this only records why.
      s.lastError = 'websocket error'
    })

    socket.addEventListener('close', () => {
      s.connected = false
      s.connecting = false
      s.socket = null
      if (!s.stopped) scheduleReconnect()
    })
  } catch (error) {
    s.connecting = false
    s.lastError = (error as Error).message
    log(`connect failed: ${s.lastError}`)
    if (!s.stopped) scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  const s = state()
  if (s.reconnectTimer || s.stopped) return
  s.attempts += 1
  // Exponential backoff with jitter — Slack recycles sockets roughly hourly,
  // and a reconnect storm is the fastest way to get an app rate-limited.
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(s.attempts, 6))
  const delay = base / 2 + Math.random() * (base / 2)
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null
    void connect()
  }, delay)
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

type Envelope = {
  type?: string
  envelope_id?: string
  retry_attempt?: number
  payload?: Record<string, unknown>
  reason?: string
}

async function onEnvelope(socket: WebSocket, raw: string): Promise<void> {
  const s = state()
  let envelope: Envelope
  try {
    envelope = JSON.parse(raw) as Envelope
  } catch {
    return
  }

  if (envelope.type === 'hello') return
  if (envelope.type === 'disconnect') {
    // Slack asks us to reconnect (refresh / rotation). Closing triggers it.
    log(`server asked us to reconnect (${envelope.reason ?? 'no reason'})`)
    try {
      socket.close()
    } catch {
      // Already closing.
    }
    return
  }

  // Ack first, always. Slack resends anything unacknowledged within 3 seconds,
  // and a run can take far longer than that to answer.
  if (envelope.envelope_id) {
    try {
      socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }))
    } catch {
      // Socket died between receive and ack — the retry will find us again.
    }

    if (s.seen.has(envelope.envelope_id)) return
    s.seen.add(envelope.envelope_id)
    if (s.seen.size > SEEN_LIMIT) {
      // Cheap bounded set: drop the oldest half rather than growing forever.
      const keep = [...s.seen].slice(-SEEN_LIMIT / 2)
      s.seen.clear()
      for (const id of keep) s.seen.add(id)
    }
  }

  // A retry means our ack was lost, not that the user asked twice.
  if ((envelope.retry_attempt ?? 0) > 0) return

  try {
    if (envelope.type === 'events_api') await onEventsApi(envelope.payload ?? {})
    else if (envelope.type === 'slash_commands') await onSlashCommand(envelope.payload ?? {})
    else if (envelope.type === 'interactive') await onInteractive(envelope.payload ?? {})
  } catch (error) {
    log(`handler failed: ${(error as Error).message}`)
  }
}

async function onEventsApi(payload: Record<string, unknown>): Promise<void> {
  const event = (payload.event ?? {}) as Record<string, unknown>
  const type = String(event.type ?? '')
  if (type !== 'message' && type !== 'app_mention') return

  // Edits, deletions, joins and thread-broadcast echoes are not commands.
  if (event.subtype) return

  const s = state()
  const userId = String(event.user ?? '')
  const botId = event.bot_id ? String(event.bot_id) : undefined
  // Never react to ourselves — that is an infinite loop with a bot token.
  if (botId || (s.botUserId && userId === s.botUserId)) return

  const channelId = String(event.channel ?? '')
  const threadTs = event.thread_ts ? String(event.thread_ts) : undefined
  const messageTs = String(event.ts ?? '')
  const text = String(event.text ?? '')

  // In a channel, only answer when mentioned or when the message is in a
  // thread we own — otherwise every message in the channel is a command.
  const isDm = String(event.channel_type ?? '') === 'im'
  const mentioned = type === 'app_mention'
  if (!isDm && !mentioned && !threadTs) return

  await respond(text, {
    userId,
    channelId,
    threadTs,
    messageTs,
    botId,
    source: mentioned ? 'mention' : isDm ? 'dm' : 'thread',
  })
}

async function onSlashCommand(payload: Record<string, unknown>): Promise<void> {
  await respond(String(payload.text ?? ''), {
    userId: String(payload.user_id ?? ''),
    channelId: String(payload.channel_id ?? ''),
    source: 'slash',
  })
}

async function onInteractive(payload: Record<string, unknown>): Promise<void> {
  await handleBlockAction(payload)
}

/** Run a command and post the answer back into Slack. */
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

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function slackConnectionStatus(): SlackConnectionStatus {
  const s = state()
  const settings = getSlackSettings()
  const configured = slackConfigRefusal(settings) === null

  return {
    configured,
    enabled: settings.enabled,
    connected: s.connected,
    transport: s.connected ? 'socket' : settings.signingSecret ? 'http' : 'none',
    teamName: s.teamName,
    botUserId: s.botUserId,
    lastError: s.lastError,
    lastConnectedAt: s.lastConnectedAt,
    allowedUserCount: settings.allowedUserIds.length,
  }
}

export function isSlackSocketConnected(): boolean {
  return state().connected
}
