/**
 * Start / complete Open Run cloud login and Jira OAuth against the control
 * plane. The browser does the human part; this process only ever handles the
 * loopback callback and the token exchange.
 */
import { hostname, platform } from 'node:os'
import { cloudJiraStartUrl, cloudLoginUrl, localCloudCallbackUrl } from '../../lib/cloud/login.ts'
import { createPkcePair, randomOAuthState } from '../../lib/cloud/pkce.ts'
import type { CloudSessionStored } from '../../lib/cloud/types.ts'
import { CLOUD_PATHS, resolveCloudUrl } from '../../lib/cloud/url.ts'
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
/** Refresh this far before the access token actually lapses. */
const REFRESH_SKEW_MS = 10 * 60 * 1000

export function configuredCloudUrl(): string | null {
  return resolveCloudUrl(process.env.AGENTOPS_CLOUD_URL)
}

function deviceName(): string {
  try {
    return hostname()
  } catch {
    return ''
  }
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
      name: deviceName(),
      platform: platform(),
    }),
  }
}

type TokenResponse = {
  accessToken?: string
  refreshToken?: string
  accessExpiresAt?: number
  userId?: string
  email?: string
  error?: string
}

async function exchange(cloudUrl: string, body: Record<string, string>): Promise<CloudSessionStored> {
  const res = await fetch(`${cloudUrl}${CLOUD_PATHS.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !parsed.accessToken || !parsed.refreshToken || !parsed.userId) {
    throw new Error(parsed.error || `Sign in failed (${res.status})`)
  }
  const session: CloudSessionStored = {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    accessExpiresAt: parsed.accessExpiresAt ?? 0,
    userId: parsed.userId,
    email: parsed.email ?? '',
    machineId: readMachineId(),
  }
  writeCloudSession(session)
  return session
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

  const session = await exchange(cloudUrl, {
    code: input.code,
    code_verifier: pending.verifier,
    machine_id: readMachineId(),
    redirect_uri: pending.redirectUri,
  })
  clearPkcePending()
  return session
}

/**
 * Return a usable access token, rotating the pair when it is close to expiry.
 * A failed refresh clears the session rather than looping — the user signs in
 * again from the sidebar.
 */
export async function currentAccessToken(): Promise<string | null> {
  const session = readCloudSession()
  if (!session) return null
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) return null

  const expiry = session.accessExpiresAt ?? 0
  if (expiry === 0 || expiry - Date.now() > REFRESH_SKEW_MS) return session.accessToken

  try {
    const refreshed = await exchange(cloudUrl, {
      refresh_token: session.refreshToken,
      machine_id: session.machineId,
    })
    return refreshed.accessToken
  } catch (err) {
    console.error('[cloud] refresh failed, signing out', err)
    clearCloudSession()
    return null
  }
}

export function signOutCloud(): void {
  clearCloudSession()
  clearPkcePending()
}

export function startJiraConnect(origin: string): { url: string } {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) throw new Error('Cloud is turned off.')
  if (!readCloudSession()) throw new Error('Sign in first.')
  const state = randomOAuthState()
  const redirectUri = localCloudCallbackUrl(origin)
  writePkcePending({ verifier: 'jira', state, redirectUri, createdAt: Date.now() })
  return { url: cloudJiraStartUrl({ cloudUrl, redirectUri, state }) }
}
