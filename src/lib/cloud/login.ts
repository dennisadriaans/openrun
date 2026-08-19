/**
 * Browser-safe URL builders for the control-plane device approval and hosted
 * integration OAuth start.
 */
import { CLOUD_PATHS, integrationStartPath } from './url.ts'

export function cloudLoginUrl(input: {
  cloudUrl: string
  redirectUri: string
  machineId: string
  codeChallenge: string
  state: string
  name?: string
  platform?: string
}): string {
  const url = new URL(CLOUD_PATHS.connect, input.cloudUrl)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('machine_id', input.machineId)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('state', input.state)
  if (input.name) url.searchParams.set('name', input.name)
  if (input.platform) url.searchParams.set('platform', input.platform)
  return url.toString()
}

/**
 * No token on the query string: the control plane authenticates this hop with
 * the ordinary browser session, and prompts for sign-in when there isn't one.
 */
export function cloudIntegrationStartUrl(input: {
  cloudUrl: string
  provider: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(integrationStartPath(input.provider), input.cloudUrl)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  return url.toString()
}

export function localCloudCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/cloud/callback`
}

/**
 * Where to land the user after sign-in, so clicking Connect while signed out
 * resumes the connect instead of dumping them on the automations list.
 *
 * Only a path inside this app is allowed. The value is written to disk before
 * the browser leaves and read back by the callback route, so anything that
 * could name another origin would turn our own callback into an open redirect.
 */
export function safeLocalNext(raw: string | undefined | null): string {
  const value = (raw ?? '').trim()
  // A protocol-relative `//evil.example` is a URL, not a path.
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  // Backslashes are normalized to slashes by some browsers before parsing.
  if (value.includes('\\')) return ''
  return value
}
