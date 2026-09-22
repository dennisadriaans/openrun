/**
 * Which edition is running, and where the open-core line sits.
 *
 * Open Run is open core. This module is the machine-readable form of the
 * commitment in the README: **everything that runs on your machine is AGPLv3
 * and stays that way.** What is sold separately is the set of things that need
 * somebody else's server — a fleet dashboard across machines, hosted run
 * history, remote runners, SSO, audit, policy.
 *
 * Two consequences are load-bearing and are asserted in the colocated test:
 *
 * 1. **`local` is not a degraded tier.** No feature in this repository consults
 *    the edition before deciding whether to work. There is no feature flag
 *    hiding working code, and a search for one should keep coming up empty.
 * 2. **`connected` only ever adds.** Attaching a control plane can light up
 *    extra surfaces; it cannot remove or gate a local one.
 *
 * Browser-safe and dependency-free like everything in `lib/` — the values come
 * from the caller, so the UI and the server agree on what is running.
 */

export type Edition =
  /** No control plane configured. The default, and fully functional. */
  | 'local'
  /** A commercial control plane is attached. Adds surfaces; removes none. */
  | 'connected'

export type EditionConfig = {
  /** `AGENTOPS_CLOUD_URL`, or the baked-in default when unset. */
  cloudUrl?: string | null
  /**
   * A stored control-plane session. URL alone is not enough — a baked-in
   * default must not flip every clone into `connected` before anyone signs in.
   */
  hasSession?: boolean
}

/**
 * Resolve the running edition.
 *
 * `connected` requires both a usable absolute `http(s)` URL *and* a session.
 * A typo in the URL, or a URL with no login, degrades to the fully-working
 * local app — never to a broken half-attached state.
 */
export function resolveEdition(config: EditionConfig): Edition {
  if (!config.hasSession) return 'local'

  const raw = config.cloudUrl?.trim()
  if (!raw) return 'local'

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return 'local'
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'local'

  return 'connected'
}

/** Human-readable label for the edition, for UI and boot logs. */
export function editionLabel(edition: Edition): string {
  return edition === 'connected' ? 'Connected' : 'Local'
}

/**
 * Capabilities that require a control plane.
 *
 * Listed so the boundary is inspectable rather than tribal knowledge. Every
 * entry names something that cannot work from a single machine on its own —
 * not something withheld to create an upgrade path.
 */
export const CONTROL_PLANE_CAPABILITIES = [
  'fleet-dashboard',
  'hosted-run-history',
  'hosted-webhook-ingress',
  'integration-proxy',
  'remote-runners',
  'team-seats',
  'sso',
  'audit-log',
  'org-policy',
] as const

export type ControlPlaneCapability = (typeof CONTROL_PLANE_CAPABILITIES)[number]

/**
 * Is this capability available in the running edition?
 *
 * Only ever consulted for the capabilities above. A local feature must never
 * be routed through this function — that is the difference between open core
 * and a crippled free tier.
 */
export function hasControlPlaneCapability(
  edition: Edition,
  capability: ControlPlaneCapability,
): boolean {
  return edition === 'connected' && CONTROL_PLANE_CAPABILITIES.includes(capability)
}
