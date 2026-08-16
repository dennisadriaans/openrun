import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { IntegrationBrandIcon, IntegrationCard } from '../components/IntegrationCard'
import { PageHeader } from '../components/ui'
import { providerPageTitle } from '../lib/integrations/catalog'
import type { IntegrationProviderId } from '../lib/integrations/types'
import { useIntegrationProviders, useIntegrations, useUpdateIntegration } from '../lib/queries'

export const Route = createFileRoute('/integrations/')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const navigate = useNavigate()
  const { data: providers } = useIntegrationProviders()
  const { data: integrations } = useIntegrations()
  const update = useUpdateIntegration()

  const connectionsOf = (id: IntegrationProviderId) =>
    (integrations ?? []).filter((row) => row.provider === id)

  const openProvider = (id: IntegrationProviderId) => {
    void navigate({ to: '/integrations/$provider', params: { provider: id } })
  }

  const toggleProvider = (id: IntegrationProviderId, next: boolean) => {
    const rows = connectionsOf(id)
    if (rows.length === 0) {
      if (next) openProvider(id)
      return
    }
    const target = rows[0]!
    void update.mutateAsync({ id: target.id, enabled: next })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader title="Integrations" />

      <div className="grid gap-3 sm:grid-cols-2">
        {(providers ?? []).map((p) => {
          const id = p.id as IntegrationProviderId
          const rows = connectionsOf(id)
          const configured = rows.length > 0
          return (
            <IntegrationCard
              key={p.id}
              title={providerPageTitle(id)}
              badge="Webhooks"
              badgeTone="purple"
              description={p.description}
              icon={<IntegrationBrandIcon id={id} />}
              enabled={configured && rows.some((row) => row.enabled)}
              configured={configured}
              onToggle={(next) => toggleProvider(id, next)}
              onAction={() => openProvider(id)}
              toggleDisabled={update.isPending}
            />
          )
        })}
      </div>
    </div>
  )
}
