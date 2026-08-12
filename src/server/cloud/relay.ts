/**
 * Outbound WebSocket to the control plane.
 *
 * The laptop dials out (same posture as Slack Socket Mode) so Jira can reach
 * this machine without a tunnel. Guarded on globalThis so Vite HMR cannot
 * leave two sockets connected.
 */
import type { CloudRelayStatus, RelayClientMessage } from '../../lib/cloud/types.ts'
import { parseRelayServerMessage } from '../../lib/cloud/types.ts'
import { cloudWsUrl } from '../../lib/cloud/url.ts'
import { ingestCanonicalEvent } from '../integrations/dispatcher.ts'
import { findIntegrationByCloudConnection } from '../integrations/connections.ts'
import { configuredCloudUrl } from './login.ts'
import { readCloudSession } from './session.ts'

type RelayState = {
  socket: WebSocket | null
  connected: boolean
  connecting: boolean
  reconnectTimer: ReturnType<typeof setTimeout> | null
  attempts: number
  lastError: string
  lastConnectedAt: number | null
  stopped: boolean
}

const GLOBAL_KEY = '__agentops_cloud_relay__'
const MAX_BACKOFF_MS = 60_000

function state(): RelayState {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      socket: null,
      connected: false,
      connecting: false,
      reconnectTimer: null,
      attempts: 0,
      lastError: '',
      lastConnectedAt: null,
      stopped: true,
    } satisfies RelayState
  }
  return g[GLOBAL_KEY] as RelayState
}

function log(message: string) {
  console.log(`[cloud] ${message}`)
}

function send(message: RelayClientMessage): void {
  const socket = state().socket
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message))
}

function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

function scheduleReconnect(): void {
  const s = state()
  if (s.stopped || s.reconnectTimer) return
  s.attempts += 1
  const wait = backoffMs(s.attempts)
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null
    void connect()
  }, wait)
}

async function onMessage(raw: string): Promise<void> {
  const message = parseRelayServerMessage(raw)
  if (!message) return

  if (message.type === 'hello_ok') {
    log(`connected as ${message.email}`)
    return
  }
  if (message.type === 'hello_err') {
    state().lastError = message.error
    log(`hello rejected: ${message.error}`)
    return
  }

  const local = findIntegrationByCloudConnection(message.cloudConnectionId)
  if (!local) {
    send({
      type: 'webhook.ack',
      deliveryId: message.event.deliveryId,
      runIds: [],
      error: 'no local connection for this hosted integration',
    })
    return
  }

  const result = await ingestCanonicalEvent(local.id, message.event)
  const runIds = Array.isArray(result.body.runs)
    ? (result.body.runs as Array<{ runId?: string }>)
        .map((row) => row.runId)
        .filter((id): id is string => Boolean(id))
    : []
  send({
    type: 'webhook.ack',
    deliveryId: message.event.deliveryId,
    runIds,
    error: result.ok ? undefined : String(result.body.error ?? 'ingest failed'),
  })
}

async function connect(): Promise<void> {
  const s = state()
  if (s.stopped || s.connecting || s.connected) return

  const cloudUrl = configuredCloudUrl()
  const session = readCloudSession()
  if (!cloudUrl || !session) {
    s.lastError = cloudUrl ? 'not signed in' : 'cloud disabled'
    return
  }

  s.connecting = true
  try {
    const socket = new WebSocket(
      `${cloudWsUrl(cloudUrl)}?access_token=${encodeURIComponent(session.accessToken)}`,
    )
    s.socket = socket

    socket.addEventListener('open', () => {
      s.connected = true
      s.connecting = false
      s.attempts = 0
      s.lastError = ''
      s.lastConnectedAt = Date.now()
      send({
        type: 'hello',
        machineId: session.machineId,
        accessToken: session.accessToken,
      })
    })

    socket.addEventListener('message', (event) => {
      void onMessage(String((event as MessageEvent).data ?? ''))
    })

    socket.addEventListener('error', () => {
      s.lastError = 'websocket error'
    })

    socket.addEventListener('close', () => {
      s.connected = false
      s.connecting = false
      s.socket = null
      if (!s.stopped) scheduleReconnect()
    })
  } catch (err) {
    s.connecting = false
    s.lastError = err instanceof Error ? err.message : String(err)
    scheduleReconnect()
  }
}

export function cloudRelayStatus(): CloudRelayStatus {
  const s = state()
  return {
    connected: s.connected,
    lastError: s.lastError,
    lastConnectedAt: s.lastConnectedAt,
  }
}

export async function startCloudRelay(): Promise<void> {
  const s = state()
  if (!readCloudSession() || !configuredCloudUrl()) return
  if (s.connected || s.connecting) return
  s.stopped = false
  await connect()
}

export function stopCloudRelay(): void {
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

export async function restartCloudRelay(): Promise<void> {
  stopCloudRelay()
  await startCloudRelay()
}
