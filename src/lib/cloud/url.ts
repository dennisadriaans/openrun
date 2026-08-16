/**
 * Where the optional control plane lives.
 *
 * A baked-in default lets Sign in work with no env file. Override with
 * `AGENTOPS_CLOUD_URL` (a local dev server, a self-hosted plane). `off` / `0`
 * disables the cloud client entirely — the local app stays fully usable.
 */

export const DEFAULT_CLOUD_URL = 'https://openrun.sh'

/** Control-plane paths. Kept together so a rename cannot half-land. */
export const CLOUD_PATHS = {
  connect: '/connect',
  token: '/api/machine/token',
  ticket: '/api/machine/ticket',
  relay: '/api/machine/relay',
  jiraStart: '/api/integrations/jira/start',
} as const

export function resolveCloudUrl(raw?: string | null): string | null {
  const value = (raw ?? '').trim()
  if (value === 'off' || value === '0') return null
  const candidate = value || DEFAULT_CLOUD_URL
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return candidate.replace(/\/+$/, '')
}

export function cloudWsUrl(cloudUrl: string): string {
  const parsed = new URL(cloudUrl)
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
  parsed.pathname = CLOUD_PATHS.relay
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}
