/**
 * Providers this machine can receive a webhook for directly.
 *
 * Register a new provider here — webhook HTTP route + dispatcher pick it up
 * automatically via the connection's `provider` column. Deliberately narrower
 * than the UI catalog in `lib/integrations/catalog.ts`: a provider that is only
 * connectable through the control plane never needs local verify/parse, because
 * the Worker has already done both by the time the event reaches the relay.
 */
import type { IntegrationProviderId } from '../../lib/integrations/types.ts'
import type { IntegrationProvider } from './types.ts'
import { githubProvider } from './providers/github.ts'
import { jiraProvider } from './providers/jira.ts'
import { linearProvider } from './providers/linear.ts'

const PROVIDERS: Partial<Record<IntegrationProviderId, IntegrationProvider>> = {
  github: githubProvider,
  jira: jiraProvider,
  linear: linearProvider,
}

export function listIntegrationProviders(): IntegrationProvider[] {
  return Object.values(PROVIDERS).filter((p): p is IntegrationProvider => Boolean(p))
}

export function getIntegrationProvider(id: string): IntegrationProvider | undefined {
  return PROVIDERS[id as IntegrationProviderId]
}

export function assertIntegrationProvider(id: string): IntegrationProvider {
  const p = getIntegrationProvider(id)
  if (!p) throw new Error(`Unknown integration provider: ${id}`)
  return p
}
