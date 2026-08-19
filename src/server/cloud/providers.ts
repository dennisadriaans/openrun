/**
 * Ask the control plane which integrations it can connect.
 *
 * Unauthenticated on purpose: the app has to render the integrations list
 * before anyone signs in, and the answer carries no secret — only which vendors
 * the deployment registered an OAuth app for.
 *
 * Cached on `globalThis` so the answer survives Vite HMR and a page full of
 * provider cards costs one request, not one per card.
 */
import {
  parseCloudProviderCatalog,
  UNREACHABLE_CATALOG,
  type CloudProviderCatalog,
} from '../../lib/cloud/providers.ts'
import { CLOUD_PATHS } from '../../lib/cloud/url.ts'
import { configuredCloudUrl } from './login.ts'

const GLOBAL_KEY = '__openrun_cloud_providers__'
/** Matches the endpoint's own cache header. */
const TTL_MS = 60_000
/** Shorter, so an operator who just added a secret is not stuck behind a miss. */
const FAILURE_TTL_MS = 15_000
const REQUEST_TIMEOUT_MS = 8_000

type CacheEntry = { cloudUrl: string; expiresAt: number; catalog: CloudProviderCatalog }

function cache(): { entry: CacheEntry | null } {
  const g = globalThis as Record<string, unknown>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { entry: null }
  return g[GLOBAL_KEY] as { entry: CacheEntry | null }
}

/** Drop the cache so the next read re-asks — used after sign-in and sign-out. */
export function forgetCloudProviders(): void {
  cache().entry = null
}

export async function listCloudProviders(): Promise<CloudProviderCatalog> {
  const cloudUrl = configuredCloudUrl()
  if (!cloudUrl) return UNREACHABLE_CATALOG

  const slot = cache()
  const hit = slot.entry
  if (hit && hit.cloudUrl === cloudUrl && hit.expiresAt > Date.now()) return hit.catalog

  let catalog = UNREACHABLE_CATALOG
  try {
    const res = await fetch(`${cloudUrl}${CLOUD_PATHS.providers}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    // A control plane too old to have this endpoint answers 404. That is
    // "cannot tell", not "nothing is available" — the panel says so rather than
    // claiming every provider is unsupported.
    if (res.ok) catalog = parseCloudProviderCatalog(await res.json())
  } catch {
    catalog = UNREACHABLE_CATALOG
  }

  slot.entry = {
    cloudUrl,
    catalog,
    expiresAt: Date.now() + (catalog.reachable ? TTL_MS : FAILURE_TTL_MS),
  }
  return catalog
}
