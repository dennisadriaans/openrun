import type { CanonicalWebhookEvent } from '../integrations/types.ts'

export type CloudSessionPublic = {
  userId: string
  email: string
  machineId: string
}

export type CloudRelayStatus = {
  connected: boolean
  lastError: string
  lastConnectedAt: number | null
}

export type CloudStatus = {
  /** Usable control-plane origin, or null when cloud is disabled. */
  cloudUrl: string | null
  signedIn: boolean
  email: string | null
  userId: string | null
  machineId: string
  relay: CloudRelayStatus
}

export type CloudSessionStored = CloudSessionPublic & {
  accessToken: string
  refreshToken: string
}

export type RelayHello = {
  type: 'hello'
  machineId: string
  accessToken: string
}

export type RelayHelloOk = {
  type: 'hello_ok'
  userId: string
  email: string
}

export type RelayHelloErr = {
  type: 'hello_err'
  error: string
}

export type RelayWebhookEvent = {
  type: 'webhook.event'
  cloudConnectionId: string
  event: CanonicalWebhookEvent
}

export type RelayWebhookAck = {
  type: 'webhook.ack'
  deliveryId: string
  runIds: string[]
  error?: string
}

export type RelayClientMessage = RelayHello | RelayWebhookAck
export type RelayServerMessage = RelayHelloOk | RelayHelloErr | RelayWebhookEvent

export function isRelayServerMessage(value: unknown): value is RelayServerMessage {
  if (!value || typeof value !== 'object') return false
  const type = (value as { type?: unknown }).type
  return type === 'hello_ok' || type === 'hello_err' || type === 'webhook.event'
}

export function parseRelayServerMessage(raw: string): RelayServerMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRelayServerMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}
