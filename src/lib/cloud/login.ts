/**
 * Browser-safe URL builders for the control-plane device approval and Jira
 * OAuth start.
 */
import { CLOUD_PATHS } from './url.ts'

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
export function cloudJiraStartUrl(input: {
  cloudUrl: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(CLOUD_PATHS.jiraStart, input.cloudUrl)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  return url.toString()
}

export function localCloudCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/cloud/callback`
}
