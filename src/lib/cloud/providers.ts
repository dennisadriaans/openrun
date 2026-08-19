/**
 * Which integrations this control plane can actually connect, and what the
 * install panel should therefore offer.
 *
 * Browser-safe and dependency-free, like every gate module: the same rules run
 * in the panel that renders the button and in the copy that explains why there
 * isn't one. A provider whose OAuth app the deployment never registered has to
 * say so *before* the click — sending the browser there answers 501, and the
 * user lands on a JSON body in a tab with no way back.
 */

export type CloudProviderInfo = {
  id: string
  label: string
  authKind: string
  /** False when the control plane has no OAuth app registered for this vendor. */
  configured: boolean
  /** True when connecting stops at a project picker before coming back. */
  picksTarget: boolean
}

export type CloudProviderCatalog = {
  /** False when the control plane is off, unreachable, or answered garbage. */
  reachable: boolean
  providers: CloudProviderInfo[]
}

export const UNREACHABLE_CATALOG: CloudProviderCatalog = { reachable: false, providers: [] }

/**
 * Read the control plane's answer defensively. It is a different deployment on
 * a different release cadence, so an older or newer shape must degrade to "we
 * could not tell" rather than throw inside a query.
 */
export function parseCloudProviderCatalog(raw: unknown): CloudProviderCatalog {
  if (!raw || typeof raw !== 'object') return UNREACHABLE_CATALOG
  const list = (raw as { providers?: unknown }).providers
  if (!Array.isArray(list)) return UNREACHABLE_CATALOG

  const providers: CloudProviderInfo[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const row = entry as Record<string, unknown>
    if (typeof row.id !== 'string' || !row.id.trim()) continue
    providers.push({
      id: row.id.trim(),
      label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : row.id.trim(),
      authKind: typeof row.authKind === 'string' ? row.authKind : 'oauth',
      configured: row.configured === true,
      picksTarget: row.picksTarget === true,
    })
  }
  return { reachable: true, providers }
}

export function cloudProvider(
  catalog: CloudProviderCatalog | null | undefined,
  provider: string,
): CloudProviderInfo | null {
  return catalog?.providers.find((row) => row.id === provider) ?? null
}

/**
 * What the install panel leads with.
 *
 * `connect` is the only path that needs no secrets from the user; everything
 * else is a reason it is unavailable. `offerLocal` is deliberately separate —
 * self-managing a webhook is a real answer for a self-hoster, but it is never
 * the headline, because pasting an API token is the thing this feature exists
 * to remove.
 */
export type IntegrationConnectPlan = {
  kind: 'loading' | 'connect' | 'sign-in' | 'unsupported' | 'cloud-off' | 'unreachable'
  /** Empty for `connect`; otherwise a sentence for the person who clicked. */
  reason: string
  /** True when connecting detours through a project picker on the way back. */
  picksTarget: boolean
  /** True when the self-managed webhook path is worth showing as a fallback. */
  offerLocal: boolean
}

export function planIntegrationConnect(input: {
  label: string
  /** Null when `OPENRUN_CLOUD_URL=off`. */
  cloudUrl: string | null
  signedIn: boolean
  /** Null while the catalog query is still in flight. */
  catalog: CloudProviderCatalog | null | undefined
  provider: string
  /** From the app catalog: does this provider have a local verify/parse path? */
  supportsLocalInstall: boolean
}): IntegrationConnectPlan {
  const local = input.supportsLocalInstall

  if (!input.cloudUrl) {
    return {
      kind: 'cloud-off',
      reason: local
        ? 'Open Run Cloud is turned off, so this connects with a webhook you host yourself.'
        : 'Open Run Cloud is turned off. Turn it back on to connect this provider.',
      picksTarget: false,
      offerLocal: local,
    }
  }

  if (!input.catalog) {
    return { kind: 'loading', reason: '', picksTarget: false, offerLocal: false }
  }

  if (!input.catalog.reachable) {
    return {
      kind: 'unreachable',
      reason: `Could not reach Open Run Cloud to check whether ${input.label} is available. Check your connection and reload.`,
      picksTarget: false,
      offerLocal: local,
    }
  }

  const remote = cloudProvider(input.catalog, input.provider)
  if (!remote?.configured) {
    return {
      kind: 'unsupported',
      reason: `${input.label} is not available on this Open Run Cloud deployment yet.`,
      picksTarget: false,
      offerLocal: local,
    }
  }

  // Signed-out is checked last on purpose: "sign in" is only worth asking for
  // once we know the provider is actually connectable afterwards.
  if (!input.signedIn) {
    return {
      kind: 'sign-in',
      reason: `Sign in to Open Run to connect ${input.label}. There is nothing to paste and no public URL to set up.`,
      picksTarget: remote.picksTarget,
      offerLocal: local,
    }
  }

  return { kind: 'connect', reason: '', picksTarget: remote.picksTarget, offerLocal: local }
}
