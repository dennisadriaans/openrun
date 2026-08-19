/**
 * Persist the Open Run control-plane session and machine id.
 *
 * Vendor tokens (Jira, …) never land here — only the Open Run access/refresh
 * pair issued by the Worker. Files are 0600 under ~/.openrun.
 */
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CloudSessionStored } from '../../lib/cloud/types.ts'
import { openrunHome } from '../db.ts'

const OWNER_ONLY = 0o600

export function cloudSessionPath(): string {
  return join(openrunHome(), 'cloud-session')
}

export function machineIdPath(): string {
  return join(openrunHome(), 'machine-id')
}

export function cloudPkcePath(): string {
  return join(openrunHome(), 'cloud-pkce')
}

function ensureHome(): void {
  const home = openrunHome()
  if (!existsSync(home)) mkdirSync(home, { recursive: true, mode: 0o700 })
}

function writeSecretFile(file: string, contents: string): void {
  ensureHome()
  writeFileSync(file, contents, { mode: OWNER_ONLY })
  chmodSync(file, OWNER_ONLY)
}

export function readMachineId(): string {
  const file = machineIdPath()
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim()
    if (stored) return stored
  }
  const id = `mch_${randomBytes(12).toString('hex')}`
  writeSecretFile(file, `${id}\n`)
  return id
}

export function readCloudSession(): CloudSessionStored | null {
  const file = cloudSessionPath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<CloudSessionStored>
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.email !== 'string' ||
      typeof parsed.machineId !== 'string'
    ) {
      return null
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      accessExpiresAt: typeof parsed.accessExpiresAt === 'number' ? parsed.accessExpiresAt : 0,
      userId: parsed.userId,
      email: parsed.email,
      machineId: parsed.machineId,
    }
  } catch {
    return null
  }
}

export function writeCloudSession(session: CloudSessionStored): void {
  writeSecretFile(cloudSessionPath(), `${JSON.stringify(session, null, 2)}\n`)
}

export function clearCloudSession(): void {
  const file = cloudSessionPath()
  if (existsSync(file)) unlinkSync(file)
}

export type PkcePending = {
  verifier: string
  state: string
  redirectUri: string
  createdAt: number
  /**
   * In-app path to land on afterwards, so signing in from a provider page
   * resumes that connect. Validated by `safeLocalNext` before it is written.
   */
  next?: string
}

export function writePkcePending(pending: PkcePending): void {
  writeSecretFile(cloudPkcePath(), `${JSON.stringify(pending)}\n`)
}

export function readPkcePending(): PkcePending | null {
  const file = cloudPkcePath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PkcePending>
    if (
      typeof parsed.verifier !== 'string' ||
      typeof parsed.state !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }
    return {
      verifier: parsed.verifier,
      state: parsed.state,
      redirectUri: parsed.redirectUri,
      createdAt: parsed.createdAt,
      ...(typeof parsed.next === 'string' ? { next: parsed.next } : {}),
    }
  } catch {
    return null
  }
}

export function clearPkcePending(): void {
  const file = cloudPkcePath()
  if (existsSync(file)) unlinkSync(file)
}

/**
 * A hosted integration connect in flight. Kept in its own file rather than in
 * the PKCE slot: connecting an integration must not discard a sign-in the user
 * started in another tab, and the callback has to know which provider it is
 * finishing without trusting the query string for it.
 */
export type ConnectPending = {
  provider: string
  state: string
  redirectUri: string
  createdAt: number
}

export function cloudConnectPath(): string {
  return join(openrunHome(), 'cloud-connect')
}

export function writeConnectPending(pending: ConnectPending): void {
  writeSecretFile(cloudConnectPath(), `${JSON.stringify(pending)}\n`)
}

export function readConnectPending(): ConnectPending | null {
  const file = cloudConnectPath()
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<ConnectPending>
    if (
      typeof parsed.provider !== 'string' ||
      typeof parsed.state !== 'string' ||
      typeof parsed.redirectUri !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }
    return {
      provider: parsed.provider,
      state: parsed.state,
      redirectUri: parsed.redirectUri,
      createdAt: parsed.createdAt,
    }
  } catch {
    return null
  }
}

export function clearConnectPending(): void {
  const file = cloudConnectPath()
  if (existsSync(file)) unlinkSync(file)
}

export type OnboardingState = {
  /** Set when the user picked "continue without an account". */
  skipped: boolean
  seenAt: number
}

export function onboardingPath(): string {
  return join(openrunHome(), 'onboarding')
}

export function readOnboarding(): OnboardingState {
  const file = onboardingPath()
  if (!existsSync(file)) return { skipped: false, seenAt: 0 }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<OnboardingState>
    return {
      skipped: parsed.skipped === true,
      seenAt: typeof parsed.seenAt === 'number' ? parsed.seenAt : 0,
    }
  } catch {
    return { skipped: false, seenAt: 0 }
  }
}

export function writeOnboarding(state: OnboardingState): void {
  writeSecretFile(onboardingPath(), `${JSON.stringify(state)}\n`)
}
