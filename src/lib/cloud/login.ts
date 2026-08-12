/**
 * Browser-safe URL builders for the control-plane login and Jira OAuth start.
 */

export function cloudLoginUrl(input: {
  cloudUrl: string
  redirectUri: string
  machineId: string
  codeChallenge: string
  state: string
}): string {
  const url = new URL('/login', input.cloudUrl)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('machine_id', input.machineId)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('state', input.state)
  return url.toString()
}

export function cloudJiraStartUrl(input: {
  cloudUrl: string
  redirectUri: string
  accessToken: string
  state: string
}): string {
  const url = new URL('/oauth/jira/start', input.cloudUrl)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_token', input.accessToken)
  return url.toString()
}

export function localCloudCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/cloud/callback`
}
