/**
 * APNs push for supervised approval prompts.
 *
 * Why this exists: a supervised run auto-denies after `APPROVAL_TIMEOUT_MS`
 * (5 minutes). SSE only reaches a foregrounded app, and iOS suspends a
 * backgrounded one within about 30 seconds — so without a real push, a phone
 * in a pocket misses essentially every approval. This is the mechanism that
 * makes approve-from-phone actually work.
 *
 * Two things about APNs that shape this file:
 *  - it is HTTP/2 only, and Node's `fetch`/undici does not speak HTTP/2, so
 *    this uses `node:http2` directly and keeps one session alive;
 *  - its auth is an ES256 JWT, which `node:crypto` can sign with no dependency
 *    once you ask for the IEEE-P1363 (raw r‖s) encoding rather than DER.
 *
 * The signing key stays a file on disk referenced by env var and is never read
 * into the database — `integrations.secret` is already stored in plaintext, and
 * a second, more valuable plaintext secret would be a step backwards.
 */
import { connect, constants, type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2'
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { pushableDevices, registerPushToken } from './devices'
import type { DeviceRow } from '../db'

const PROD_HOST = 'https://api.push.apple.com'
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com'

/** Apple rejects a token older than an hour; refresh well before that. */
const JWT_TTL_MS = 50 * 60 * 1000

export type ApnsConfig = {
  keyPath: string
  keyId: string
  teamId: string
  /** The app's bundle id — APNs calls this the topic. */
  topic: string
  /** Default environment for devices that did not report one. */
  defaultEnv: 'sandbox' | 'production'
}

/**
 * Read config from the environment. Returns null when APNs is not set up,
 * which is a supported state: the app falls back to foreground SSE plus local
 * notifications, and anyone without a paid Apple Developer account stays there.
 */
export function apnsConfig(): ApnsConfig | null {
  const keyPath = process.env.AGENTOPS_APNS_KEY_PATH?.trim()
  const keyId = process.env.AGENTOPS_APNS_KEY_ID?.trim()
  const teamId = process.env.AGENTOPS_APNS_TEAM_ID?.trim()
  const topic = process.env.AGENTOPS_APNS_TOPIC?.trim()
  if (!keyPath || !keyId || !teamId || !topic) return null
  return {
    keyPath,
    keyId,
    teamId,
    topic,
    defaultEnv: process.env.AGENTOPS_APNS_ENV?.trim() === 'production' ? 'production' : 'sandbox',
  }
}

export function apnsConfigured(): boolean {
  return apnsConfig() !== null
}

// ---------------------------------------------------------------------------
// Provider token
// ---------------------------------------------------------------------------

const g = globalThis as unknown as {
  __agentopsApnsJwt?: { token: string; issuedAt: number; keyId: string }
  __agentopsApnsSessions?: Map<string, ClientHttp2Session>
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Sign the APNs provider JWT, caching it. Apple rate-limits providers that
 * mint a fresh token per push, so the cache is required, not an optimisation.
 */
function providerToken(config: ApnsConfig): string {
  const cached = g.__agentopsApnsJwt
  const now = Date.now()
  if (cached && cached.keyId === config.keyId && now - cached.issuedAt < JWT_TTL_MS) {
    return cached.token
  }

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: config.keyId }))
  const claims = base64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }))
  const signingInput = `${header}.${claims}`

  const key = readFileSync(config.keyPath, 'utf8')
  const signer = createSign('SHA256')
  signer.update(signingInput)
  signer.end()
  // JWS wants the raw r‖s pair; the default DER encoding would be rejected.
  const signature = signer.sign({ key, dsaEncoding: 'ieee-p1363' })

  const token = `${signingInput}.${base64url(signature)}`
  g.__agentopsApnsJwt = { token, issuedAt: now, keyId: config.keyId }
  return token
}

// ---------------------------------------------------------------------------
// HTTP/2 transport
// ---------------------------------------------------------------------------

function sessions(): Map<string, ClientHttp2Session> {
  if (!g.__agentopsApnsSessions) g.__agentopsApnsSessions = new Map()
  return g.__agentopsApnsSessions
}

/** One long-lived session per host; Apple expects reuse, not a connect per push. */
function session(host: string): ClientHttp2Session {
  const existing = sessions().get(host)
  if (existing && !existing.closed && !existing.destroyed) return existing

  const created = connect(host)
  // A dead session must not take the process with it.
  created.on('error', () => sessions().delete(host))
  created.on('close', () => sessions().delete(host))
  sessions().set(host, created)
  return created
}

/** Close every APNs session — used by the shutdown path and by tests. */
export function closeApnsSessions(): void {
  for (const [host, s] of sessions()) {
    try {
      s.close()
    } catch {
      // already gone
    }
    sessions().delete(host)
  }
}

type ApnsResponse = { status: number; reason: string }

function postNotification(input: {
  host: string
  deviceToken: string
  payload: unknown
  headers: Record<string, string>
}): Promise<ApnsResponse> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (status: number, reason: string) => {
      if (settled) return
      settled = true
      resolve({ status, reason })
    }

    let stream: ClientHttp2Stream
    try {
      stream = session(input.host).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${input.deviceToken}`,
        ...input.headers,
      })
    } catch (err) {
      finish(0, err instanceof Error ? err.message : 'connect failed')
      return
    }

    let status = 0
    let body = ''
    stream.setEncoding('utf8')
    stream.on('response', (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0)
    })
    stream.on('data', (chunk: string) => {
      body += chunk
    })
    stream.on('end', () => {
      let reason = ''
      if (body) {
        try {
          reason = String((JSON.parse(body) as { reason?: string }).reason ?? '')
        } catch {
          reason = body.slice(0, 200)
        }
      }
      finish(status, reason)
    })
    stream.on('error', (err: Error) => finish(0, err.message))
    stream.setTimeout(10_000, () => {
      stream.close()
      finish(0, 'timeout')
    })

    stream.end(JSON.stringify(input.payload))
  })
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Device tokens Apple told us are dead, so we stop pushing to them. */
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'])

function hostFor(device: DeviceRow, config: ApnsConfig): string {
  const env = device.pushEnv || config.defaultEnv
  return env === 'production' ? PROD_HOST : SANDBOX_HOST
}

/**
 * Push an approval prompt to every paired phone.
 *
 * Fire-and-forget and never throws: the executor calls this from the same
 * place it schedules the auto-deny timer, and a push failure must not disturb
 * a run. Same contract as `notifyRunFinished`.
 */
export async function pushApprovalRequest(input: {
  runId: string
  requestId: string
  toolName: string
  taskName: string
  expiresAt: number
}): Promise<void> {
  const config = apnsConfig()
  if (!config) return

  let devices: DeviceRow[]
  try {
    devices = pushableDevices()
  } catch {
    return
  }
  if (devices.length === 0) return

  let token: string
  try {
    token = providerToken(config)
  } catch {
    // Unreadable or malformed .p8 — nothing to do but stay quiet.
    return
  }

  const payload = {
    aps: {
      alert: {
        title: 'Approval needed',
        body: `${input.taskName} wants to run ${input.toolName}`,
      },
      sound: 'default',
      // Pierces Focus modes — the whole point is a 5-minute deadline.
      'interruption-level': 'time-sensitive',
      'thread-id': input.runId,
    },
    runId: input.runId,
    requestId: input.requestId,
    expiresAt: input.expiresAt,
  }

  // Tell APNs to stop trying once the executor would have auto-denied.
  const expirationSeconds = Math.max(0, Math.floor(input.expiresAt / 1000))

  await Promise.all(
    devices.map(async (device) => {
      try {
        const result = await postNotification({
          host: hostFor(device, config),
          deviceToken: device.pushToken,
          payload,
          headers: {
            'apns-topic': config.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-expiration': String(expirationSeconds),
            'apns-collapse-id': input.requestId.slice(0, 64),
            authorization: `bearer ${token}`,
            'content-type': 'application/json',
          },
        })
        if (result.status === 410 || DEAD_TOKEN_REASONS.has(result.reason)) {
          registerPushToken({ deviceId: device.id, pushToken: '', pushEnv: device.pushEnv })
        }
      } catch {
        // Never propagate into the executor.
      }
    }),
  )
}

/** Silent push telling phones an approval is no longer waiting. */
export async function pushApprovalSettled(input: {
  runId: string
  requestId: string
  decision: 'allow' | 'deny'
}): Promise<void> {
  const config = apnsConfig()
  if (!config) return

  let devices: DeviceRow[]
  let token: string
  try {
    devices = pushableDevices()
    if (devices.length === 0) return
    token = providerToken(config)
  } catch {
    return
  }

  const payload = {
    aps: { 'content-available': 1 },
    runId: input.runId,
    requestId: input.requestId,
    decision: input.decision,
    settled: true,
  }

  await Promise.all(
    devices.map(async (device) => {
      try {
        await postNotification({
          host: hostFor(device, config),
          deviceToken: device.pushToken,
          payload,
          headers: {
            'apns-topic': config.topic,
            'apns-push-type': 'background',
            // Background pushes must be priority 5; Apple rejects 10.
            'apns-priority': '5',
            'apns-collapse-id': input.requestId.slice(0, 64),
            authorization: `bearer ${token}`,
            'content-type': 'application/json',
          },
        })
      } catch {
        // Never propagate into the executor.
      }
    }),
  )
}
