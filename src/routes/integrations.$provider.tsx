/**
 * Shared connect/detail template for every provider.
 *
 * A connection lives on the control plane and receives events over the relay —
 * this machine never exposes a webhook URL and holds no vendor credential.
 */
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { IntegrationAutomationSetup } from '../components/IntegrationAutomationSetup'
import { IntegrationBrandIcon } from '../components/IntegrationCard'
import { IntegrationConnectPanel } from '../components/IntegrationConnect'
import { IntegrationPage, IntegrationStatusBanner } from '../components/IntegrationPage'
import { Button, Card } from '../components/ui'
import {
  isIntegrationProviderId,
  providerMeta,
  providerPageTitle,
} from '../lib/integrations/catalog'
import { describeWebhookDelivery } from '../lib/integrations/delivery'
import type { IntegrationProviderId } from '../lib/integrations/types'
import { absoluteTime } from '../lib/format'
import {
  useCloudStatus,
  useDisconnectHostedIntegration,
  useHostedConnections,
  useIngestTestEvent,
  useIntegrations,
  useTasks,
  useUpdateIntegration,
  useWebhookDeliveries,
} from '../lib/queries'

export const Route = createFileRoute('/integrations/$provider')({
  /**
   * `connect=1` is set by the sign-in round-trip so the connect the user
   * clicked resumes. Absent rather than `false` when unset, so every other link
   * to this page stays a plain URL.
   */
  validateSearch: (search: Record<string, unknown>): { connect?: true } =>
    search.connect === '1' || search.connect === true ? { connect: true } : {},
  beforeLoad: ({ params }) => {
    if (!isIntegrationProviderId(params.provider)) {
      throw redirect({ to: '/integrations' })
    }
  },
  component: IntegrationProviderPage,
})

function IntegrationProviderPage() {
  const { provider: raw } = Route.useParams()
  const { connect } = Route.useSearch()
  if (!isIntegrationProviderId(raw)) return null
  return <ProviderDetail provider={raw} autoConnect={connect === true} />
}

function ProviderDetail({
  provider,
  autoConnect,
}: {
  provider: IntegrationProviderId
  autoConnect: boolean
}) {
  const navigate = useNavigate()
  const meta = providerMeta(provider)
  const title = providerPageTitle(provider)
  const { data: integrations, isLoading } = useIntegrations()
  const { data: tasks } = useTasks()
  const { data: deliveries } = useWebhookDeliveries()
  const update = useUpdateIntegration()
  const disconnectHosted = useDisconnectHostedIntegration()
  const testEvent = useIngestTestEvent()
  const { data: cloud } = useCloudStatus()
  const { data: hostedConnections } = useHostedConnections()

  const [adding, setAdding] = useState(false)
  const [remoteNote, setRemoteNote] = useState<string | null>(null)
  const [deliveriesOpen, setDeliveriesOpen] = useState(false)

  const rows = (integrations ?? []).filter((row) => row.provider === provider)
  const configured = rows.length > 0
  const enabledCount = rows.filter((row) => row.enabled).length
  const showInstall = !configured || adding

  const boundIntegrationIds = new Set(
    (tasks ?? []).map((task) => task.webhookIntegrationId).filter(Boolean),
  )
  /**
   * The connection the user most likely just finished: newest first, and only
   * one that no automation binds yet. Without an automation a delivery arrives
   * and matches nothing, so this is the difference between "connected" and
   * "working".
   */
  const needsAutomation = rows.find((row) => !boundIntegrationIds.has(row.id))

  const providerDeliveries = (deliveries ?? []).filter((d) =>
    rows.some((row) => row.id === d.integrationId),
  )

  if (!meta) return null

  if (isLoading) {
    return (
      <IntegrationPage title={title}>
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      </IntegrationPage>
    )
  }

  // Nothing connected yet: one centered lockup instead of a page of empty chrome.
  if (!configured) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6">
        <Card className="w-full max-w-sm p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-xl border border-border bg-white">
            <IntegrationBrandIcon id={provider} className="size-7" />
          </div>
          <h1 className="mt-4 text-ui-lg font-medium tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-ui-sm text-tier-tertiary">{meta.description}</p>
          <div className="mt-6">
            <IntegrationConnectPanel provider={provider} autoConnect={autoConnect} compact />
          </div>
        </Card>
      </div>
    )
  }

  const banner =
    enabledCount > 0
      ? {
          tone: 'good' as const,
          text: `Connected · ${rows.length} endpoint${rows.length === 1 ? '' : 's'}.`,
        }
      : { tone: 'idle' as const, text: 'Paused.' }

  return (
    <IntegrationPage title={title}>
      <IntegrationStatusBanner tone={banner.tone} text={banner.text} />

      {remoteNote ? (
        <div className="mb-4 rounded-md border border-[var(--border-quaternary)] px-3 py-2 text-ui-sm text-tier-secondary">
          {remoteNote}
        </div>
      ) : null}

      {showInstall ? (
        <Card className="space-y-4 p-4">
          <IntegrationConnectPanel
            provider={provider}
            autoConnect={autoConnect}
            onCancel={configured ? () => setAdding(false) : undefined}
          />
        </Card>
      ) : null}

      {!showInstall && needsAutomation ? (
        <IntegrationAutomationSetup
          integrationId={needsAutomation.id}
          provider={provider}
          connectionName={needsAutomation.name}
          onSkip={() =>
            navigate({ to: '/tasks/new', search: { webhookIntegrationId: needsAutomation.id } })
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className={`space-y-4 ${showInstall ? 'mt-4' : ''}`}>
          {rows.map((integ) => {
            // The vendor's own words when a hook failed to register or renew.
            const remote = (hostedConnections ?? []).find((c) => c.id === integ.cloudConnectionId)
            const remoteProblem =
              remote && remote.status !== 'active'
                ? remote.statusMessage || `Connection is ${remote.status}.`
                : ''
            return (
              <Card key={integ.id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-ui-base text-foreground">{integ.name}</div>
                    <div className="mt-0.5 truncate text-ui-sm text-tier-quaternary">
                      {integ.enabled
                        ? cloud?.relay.connected
                          ? 'Receiving via cloud relay'
                          : 'Waiting for cloud relay'
                        : 'Paused'}
                      {remote?.target && remote.target.name !== integ.name
                        ? ` · ${remote.target.name}`
                        : ''}
                    </div>
                    {remoteProblem ? (
                      <div className="mt-1 text-ui-sm text-warn">{remoteProblem}</div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        navigate({
                          to: '/tasks/new',
                          search: { webhookIntegrationId: integ.id },
                        })
                      }
                    >
                      Use in automation
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        void testEvent.mutateAsync(integ.id).then((result) => {
                          setRemoteNote(
                            result.ok
                              ? // Name the event: a bound automation decides which
                                // one is sent, and "0 matched" on an unnamed event
                                // reads as a broken connection.
                                `Test ${result.eventType} delivered · ${result.matched} automation${result.matched === 1 ? '' : 's'} matched.`
                              : result.error || 'Test event failed',
                          )
                        })
                      }
                    >
                      Send test event
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        void update.mutateAsync({
                          id: integ.id,
                          enabled: !integ.enabled,
                        })
                      }
                    >
                      {integ.enabled ? 'Pause' : 'Enable'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disconnectHosted.isPending}
                      onClick={() => {
                        const warning = `Disconnect ${integ.name}? The webhook is removed at ${title} and automations will be unbound.`
                        if (!confirm(warning)) return
                        void disconnectHosted.mutateAsync(integ.id).then((result) => {
                          if (!result.ok) {
                            setRemoteNote(result.remoteError ?? 'Disconnect failed')
                            return
                          }
                          setRemoteNote(result.remoteError ?? null)
                        })
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <p className="text-ui-sm text-tier-tertiary">
                  {title} posts to the control plane. This machine does not expose a webhook URL.
                </p>
              </Card>
            )
          })}
        </div>
      ) : null}

      {configured && !adding ? (
        <div className="mt-4">
          <Button type="button" variant="ghost" onClick={() => setAdding(true)}>
            Add another connection
          </Button>
        </div>
      ) : null}

      {configured ? (
        <Card className="mt-4">
          <button
            type="button"
            onClick={() => setDeliveriesOpen((v) => !v)}
            aria-expanded={deliveriesOpen}
            className={
              deliveriesOpen
                ? 'flex w-full items-center gap-1.5 border-b border-[var(--border-quaternary)] px-4 py-3 text-left text-ui-base text-foreground'
                : 'flex w-full items-center gap-1.5 px-4 py-3 text-left text-ui-base text-foreground'
            }
          >
            {deliveriesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-tier-quaternary" />
            )}
            Recent deliveries
            {providerDeliveries.length ? (
              <span className="text-ui-sm text-tier-quaternary">({providerDeliveries.length})</span>
            ) : null}
          </button>
          {!deliveriesOpen ? null : !providerDeliveries.length ? (
            <p className="px-4 py-8 text-center text-ui-sm text-tier-quaternary">
              No webhook deliveries yet.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-quaternary)]">
              {providerDeliveries.slice(0, 20).map((d) => {
                const summary = describeWebhookDelivery({
                  status: d.status,
                  runIds: d.runIds,
                  error: d.error,
                })
                return (
                  <li key={d.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono truncate text-ui-sm text-foreground">
                        {d.eventType}
                      </span>
                      <span
                        className={
                          summary.matchedNothing
                            ? 'shrink-0 text-ui-sm text-warn'
                            : 'shrink-0 text-ui-sm text-tier-quaternary'
                        }
                      >
                        {d.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-ui-sm text-tier-quaternary">
                      {absoluteTime(d.receivedAt)}
                      {' · '}
                      <span className={summary.matchedNothing ? 'text-warn' : undefined}>
                        {summary.detail}
                      </span>
                    </div>
                    {summary.runIds.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                        {summary.runIds.slice(0, 4).map((runId) => (
                          <Link
                            key={runId}
                            to="/runs/$runId"
                            params={{ runId }}
                            viewTransition
                            className="mono text-ui-sm text-tier-secondary underline underline-offset-2 hover:text-foreground"
                          >
                            {runId}
                          </Link>
                        ))}
                        {summary.runIds.length > 4 ? (
                          <span className="text-ui-sm text-tier-quaternary">
                            +{summary.runIds.length - 4} more
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </IntegrationPage>
  )
}
