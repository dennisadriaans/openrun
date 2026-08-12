/**
 * Where the optional control plane lives.
 *
 * A baked-in default lets Sign in work with no env file. Override with
 * `AGENTOPS_CLOUD_URL` (wrangler dev, a self-hosted plane). `off` / `0`
 * disables the cloud client entirely — the local app stays fully usable.
 */

export const DEFAULT_CLOUD_URL = 'https://cloud.getopenrun.dev'

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
  parsed.pathname = '/relay'
  parsed.search = ''
  parsed.hash = ''
  return parsed.toString()
}
