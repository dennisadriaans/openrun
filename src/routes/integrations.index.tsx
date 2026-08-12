import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { IntegrationBrandIcon, IntegrationCard } from '../components/IntegrationCard'
import { PageHeader } from '../components/ui'
import { providerPageTitle } from '../lib/integrations/catalog'
import type { IntegrationProviderId } from '../lib/integrations/types'
import {
  useIntegrationProviders,
  useIntegrations,
  useSaveSlackSettings,
  useSlackSettings,
  useUpdateIntegration,
} from '../lib/queries'

export const Route = createFileRoute('/integrations/')({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const navigate = useNavigate()
  const { data: providers } = useIntegrationProviders()
  const { data: integrations } = useIntegrations()
  const { data: slack } = useSlackSettings()
  const update = useUpdateIntegration()
  const saveSlack = useSaveSlackSettings()

  const slackConfigured = Boolean(slack?.hasBotToken && slack?.hasAppToken)
  const slackEnabled = Boolean(slack?.enabled && slackConfigured)

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

  const toggleSlack = (next: boolean) => {
    if (!slackConfigured) {
      void navigate({ to: '/slack' })
      return
    }
    void saveSlack.mutateAsync({ enabled: next })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader title="Integrations" />

      <div className="grid gap-3 sm:grid-cols-2">
        <IntegrationCard
          title="Slack"
          badge="Run control"
          badgeTone="blue"
          description="Steer runs from Slack — status, start, cancel, and follow-up turns in your channels. No tunnel needed."
          icon={<IntegrationBrandIcon id="slack" />}
          enabled={slackEnabled}
          configured={slackConfigured}
          onToggle={toggleSlack}
          onAction={() => void navigate({ to: '/slack' })}
          toggleDisabled={saveSlack.isPending}
        />
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
