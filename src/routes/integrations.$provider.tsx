/**
 * Shared install/detail template for every provider.
 *
 * A hosted connection lives on the control plane and receives events over the
 * relay. A local install creates an endpoint on this machine, and additionally
 * registers the webhook at the provider when a public URL and credentials are
 * present.
 */
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { Check, Copy, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { IntegrationAutomationSetup } from '../components/IntegrationAutomationSetup'
import { IntegrationInstallPanel } from '../components/IntegrationInstall'
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
  useRemoveIntegration,
  useRotateIntegrationSecret,
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

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <div className="text-ui-sm text-tier-tertiary">{label}</div>
      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-transparent px-2.5 py-1.5 text-ui-sm text-foreground">
          {value}
        </code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-tier-tertiary hover:bg-hover hover:text-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {
              // ignore
            }
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

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
  const rotate = useRotateIntegrationSecret()
  const remove = useRemoveIntegration()
  const disconnectHosted = useDisconnectHostedIntegration()
  const testEvent = useIngestTestEvent()
  const { data: cloud } = useCloudStatus()
  const { data: hostedConnections } = useHostedConnections()

  const [adding, setAdding] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [remoteNote, setRemoteNote] = useState<string | null>(null)
  const [dismissedSetup, setDismissedSetup] = useState<string[]>([])

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
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
  const needsAutomation = rows.find(
    (row) => !boundIntegrationIds.has(row.id) && !dismissedSetup.includes(row.id),
  )

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

  const banner = !configured
    ? { tone: 'idle' as const, text: 'Not installed.' }
    : enabledCount > 0
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
          <IntegrationInstallPanel
            provider={provider}
            autoConnect={autoConnect}
            onCancel={configured ? () => setAdding(false) : undefined}
            onInstalled={(result) => {
              if (result.secret) {
                setRevealed((prev) => ({ ...prev, [result.integrationId]: result.secret! }))
              }
              setRemoteNote(result.remoteError ?? null)
              setAdding(false)
            }}
          />
        </Card>
      ) : null}

      {!showInstall && needsAutomation ? (
        <Card className="space-y-4 p-4">
          <IntegrationAutomationSetup
            provider={provider}
            integrationId={needsAutomation.id}
            integrationName={needsAutomation.name}
            onCreated={({ taskId }) => navigate({ to: '/tasks/$taskId', params: { taskId } })}
            onDismiss={() => setDismissedSetup((prev) => [...prev, needsAutomation.id])}
          />
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className={`space-y-4 ${showInstall ? 'mt-4' : ''}`}>
          {rows.map((integ) => {
            const secret = revealed[integ.id]
            const url = `${origin}${integ.webhookPath}`
            const hosted = integ.hosted
            // The vendor's own words when a hook failed to register or renew.
            const remote = hosted
              ? (hostedConnections ?? []).find((c) => c.id === integ.cloudConnectionId)
              : undefined
            const remoteProblem =
              remote && remote.status !== 'active'
                ? remote.statusMessage || `Connection is ${remote.status}.`
                : ''
            return (
              <Card key={integ.id} className="space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-ui-base text-foreground">{integ.name}</div>
                    <div className="mt-0.5 text-ui-sm text-tier-quaternary">
                      {hosted
                        ? integ.enabled
                          ? cloud?.relay.connected
                            ? 'Hosted · receiving via cloud relay'
                            : 'Hosted · waiting for cloud relay'
                          : 'Paused'
                        : integ.enabled
                          ? 'Receiving events'
                          : 'Paused'}
                      {remote?.target ? ` · ${remote.target.name}` : ''}
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
                              ? `Test event delivered · ${result.matched} automation${result.matched === 1 ? '' : 's'} matched.`
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
                    {hosted ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={async () => {
                          const row = await rotate.mutateAsync(integ.id)
                          if (row.secret) {
                            setRevealed((prev) => ({ ...prev, [integ.id]: row.secret! }))
                          }
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Rotate secret
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={disconnectHosted.isPending}
                      onClick={() => {
                        const warning = hosted
                          ? `Disconnect ${integ.name}? The webhook is removed at ${title} and automations will be unbound.`
                          : `Delete ${integ.name}? Automations will be unbound.`
                        if (!confirm(warning)) return
                        if (!hosted) {
                          void remove.mutateAsync(integ.id)
                          return
                        }
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

                {hosted ? (
                  <p className="text-ui-sm text-tier-tertiary">
                    {title} posts to the control plane. This machine does not expose a webhook URL.
                  </p>
                ) : (
                  <>
                    <CopyField label="Webhook URL" value={url} />
                    {secret ? (
                      <CopyField label="Signing secret (shown once)" value={secret} />
                    ) : (
                      <p className="text-ui-sm text-tier-tertiary">
                        Signing secret is only shown when created or rotated.
                      </p>
                    )}
                  </>
                )}
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
          <div className="border-b border-[var(--border-quaternary)] px-4 py-3 text-ui-base text-foreground">
            Recent deliveries
          </div>
          {!providerDeliveries.length ? (
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
