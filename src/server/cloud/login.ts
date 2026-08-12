/**
 * Start / complete Open Run cloud login and Jira OAuth against the Worker.
 */
import { cloudJiraStartUrl, cloudLoginUrl, localCloudCallbackUrl } from '../../lib/cloud/login.ts'
import { createPkcePair, randomOAuthState } from '../../lib/cloud/pkce.ts'
import type { CloudSessionStored } from '../../lib/cloud/types.ts'
import { resolveCloudUrl } from '../../lib/cloud/url.ts'
import {
  clearCloudSession,
  clearPkcePending,
  readCloudSession,
  readMachineId,
  readPkcePending,
  writeCloudSession,
  writePkcePending,
} from './session.ts'

const PKCE_TTL_MS = 15 * 60 * 1000

export function configuredCloudUrl(): string | null {
  return resolveCloudUrl(process.env.AGENTOPS_CLOUD_URL)
}

export async function startCloudLogin(origin: string): Promise<{ url: string }> {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) throw new Error('Cloud is turned off (AGENTOPS_CLOUD_URL=off).')
  const { verifier, challenge } = await createPkcePair()
  const state = randomOAuthState()
  const redirectUri = localCloudCallbackUrl(origin)
  writePkcePending({ verifier, state, redirectUri, createdAt: Date.now() })
  return {
    url: cloudLoginUrl({
      cloudUrl,
      redirectUri,
      machineId: readMachineId(),
      codeChallenge: challenge,
      state,
    }),
  }
}

type TokenResponse = {
  accessToken?: string
  refreshToken?: string
  userId?: string
  email?: string
  error?: string
}

export async function completeCloudLogin(input: {
  code: string
  state: string
}): Promise<CloudSessionStored> {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) throw new Error('Cloud is turned off.')
  const pending = readPkcePending()
  if (!pending) throw new Error('No login in progress. Click Sign in again.')
  if (Date.now() - pending.createdAt > PKCE_TTL_MS) {
    clearPkcePending()
    throw new Error('Sign in expired. Click Sign in again.')
  }
  if (pending.state !== input.state) {
    clearPkcePending()
    throw new Error('Sign in state mismatch. Click Sign in again.')
  }

  const res = await fetch(`${cloudUrl}/login/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: input.code,
      code_verifier: pending.verifier,
      machine_id: readMachineId(),
      redirect_uri: pending.redirectUri,
    }),
  })
  const body = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !body.accessToken || !body.refreshToken || !body.userId || !body.email) {
    throw new Error(body.error || `Sign in failed (${res.status})`)
  }

  const session: CloudSessionStored = {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.userId,
    email: body.email,
    machineId: readMachineId(),
  }
  writeCloudSession(session)
  clearPkcePending()
  return session
}

export function signOutCloud(): void {
  clearCloudSession()
  clearPkcePending()
}

export function startJiraConnect(origin: string): { url: string } {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) throw new Error('Cloud is turned off.')
  const session = readCloudSession()
  if (!session) throw new Error('Sign in first.')
  const state = randomOAuthState()
  const redirectUri = localCloudCallbackUrl(origin)
  writePkcePending({
    verifier: 'jira',
    state,
    redirectUri,
    createdAt: Date.now(),
  })
  return {
    url: cloudJiraStartUrl({
      cloudUrl,
      redirectUri,
      accessToken: session.accessToken,
      state,
    }),
  }
}
