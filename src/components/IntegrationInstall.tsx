/**
 * Connecting a provider.
 *
 * There is one headline path: **Connect**. The control plane owns the vendor
 * OAuth app, the tokens, and the webhook, so the user approves the app in their
 * browser and events arrive over this machine's outbound relay — nothing to
 * paste, no public URL, no signing secret.
 *
 * What to show is decided by `lib/cloud/providers.ts` rather than here, so the
 * button and the sentence explaining its absence can never disagree. The
 * self-managed webhook path still exists for self-hosters and for a control
 * plane that has not registered a vendor app, but it is deliberately folded
 * away: pasting an API token is the thing this feature exists to remove.
 */
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { providerMeta } from '../lib/integrations/catalog'
import { planIntegrationConnect } from '../lib/cloud/providers'
import {
  isLikelyLocalhostUrl,
  parseGithubOwnerRepo,
  readStoredPublicBaseUrl,
  storePublicBaseUrl,
} from '../lib/integrations/install'
import type { IntegrationProviderId } from '../lib/integrations/types'
import {
  useCloudProviders,
  useCloudStatus,
  useInstallContext,
  useInstallIntegration,
  useStartCloudLogin,
  useStartHostedConnect,
} from '../lib/queries'
import { Button, Field, inputClass } from './ui'

export type InstalledResult = {
  integrationId: string
  automationId: string | null
  secret?: string
  registeredRemotely: boolean
  remoteError?: string
}

export function IntegrationInstallPanel({
  provider,
  autoConnect = false,
  onCancel,
  onInstalled,
}: {
  provider: IntegrationProviderId
  /** Start the browser hop immediately — set when returning from sign-in. */
  autoConnect?: boolean
  onCancel?: () => void
  onInstalled: (result: InstalledResult) => void
}) {
  const meta = providerMeta(provider)
  const label = meta?.label ?? provider

  const { data: cloud } = useCloudStatus()
  const { data: catalog } = useCloudProviders()
  const startConnect = useStartHostedConnect()
  const startLogin = useStartCloudLogin()
  const [error, setError] = useState<string | null>(null)
  const [showLocal, setShowLocal] = useState(false)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const plan = planIntegrationConnect({
    label,
    cloudUrl: cloud?.cloudUrl ?? null,
    signedIn: Boolean(cloud?.signedIn),
    // `undefined` while the query is in flight — the plan renders "loading"
    // rather than briefly claiming the provider is unavailable.
    catalog: catalog ?? null,
    provider,
    supportsLocalInstall: meta?.supportsLocalInstall ?? false,
  })

  const connect = async () => {
    setError(null)
    try {
      const { url } = await startConnect.mutateAsync({ provider, origin })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Returning from sign-in resumes the connect the user actually clicked,
  // rather than dropping them back on a page with a button to press again.
  // Guarded by a ref, not by state: this navigates away, and firing twice would
  // start two OAuth flows and leave the second one's state on disk.
  const autoConnected = useRef(false)
  useEffect(() => {
    if (!autoConnect || plan.kind !== 'connect' || autoConnected.current) return
    autoConnected.current = true
    void connect()
  }, [autoConnect, plan.kind, connect])

  const signInThenConnect = async () => {
    setError(null)
    try {
      const { url } = await startLogin.mutateAsync({
        origin,
        next: `/integrations/${provider}?connect=1`,
      })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!meta) return null

  const errorBox = error ? (
    <p className="rounded-md border border-danger px-3 py-2 text-ui-sm text-danger">{error}</p>
  ) : null

  const cancelButton = onCancel ? (
    <Button type="button" variant="ghost" onClick={onCancel}>
      Cancel
    </Button>
  ) : null

  if (plan.kind === 'loading') {
    return <p className="text-ui-sm text-tier-tertiary">Loading…</p>
  }

  return (
    <div className="space-y-4">
      {plan.kind === 'connect' ? (
        <div className="space-y-3">
          <p className="text-ui-sm text-tier-secondary">
            Approve Open Run in {label} and you are done. Tokens stay on the control plane; this
            machine receives events over an outbound connection, so there is no tunnel to run and no
            secret to copy.
          </p>
          {plan.picksTarget ? (
            <p className="text-ui-sm text-tier-tertiary">
              {label} attaches the webhook to one project, so you will pick which one before coming
              back.
            </p>
          ) : null}
          {errorBox}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={startConnect.isPending}
              onClick={() => void connect()}
            >
              {startConnect.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening {label}…
                </>
              ) : (
                `Connect ${label}`
              )}
            </Button>
            {cancelButton}
          </div>
        </div>
      ) : null}

      {plan.kind === 'sign-in' ? (
        <div className="space-y-3">
          <p className="text-ui-sm text-tier-secondary">{plan.reason}</p>
          {errorBox}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={startLogin.isPending}
              onClick={() => void signInThenConnect()}
            >
              {startLogin.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening sign in…
                </>
              ) : (
                `Sign in and connect ${label}`
              )}
            </Button>
            {cancelButton}
          </div>
        </div>
      ) : null}

      {plan.kind === 'unsupported' || plan.kind === 'unreachable' || plan.kind === 'cloud-off' ? (
        <div className="space-y-3">
          <p className="text-ui-sm text-tier-secondary">{plan.reason}</p>
          {errorBox}
          {plan.offerLocal ? null : cancelButton}
        </div>
      ) : null}

      {plan.offerLocal ? (
        <LocalInstall
          provider={provider}
          label={label}
          // Open by default when it is the only thing that can work here.
          open={showLocal || plan.kind !== 'connect'}
          onToggle={() => setShowLocal((prev) => !prev)}
          collapsible={plan.kind === 'connect'}
          onCancel={onCancel}
          onInstalled={onInstalled}
        />
      ) : null}
    </div>
  )
}

/**
 * The self-managed path: this machine hosts the endpoint, and we register the
 * hook at the vendor when a public URL and a credential are present. Everything
 * that asks the user for a secret lives in here, behind a disclosure.
 */
function LocalInstall({
  provider,
  label,
  open,
  collapsible,
  onToggle,
  onCancel,
  onInstalled,
}: {
  provider: IntegrationProviderId
  label: string
  open: boolean
  collapsible: boolean
  onToggle: () => void
  onCancel?: () => void
  onInstalled: (result: InstalledResult) => void
}) {
  const meta = providerMeta(provider)
  const { data: ctx } = useInstallContext()
  const install = useInstallIntegration()

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const needsTunnel = isLikelyLocalhostUrl(origin)

  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [linearKey, setLinearKey] = useState('')
  const [jiraSite, setJiraSite] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = readStoredPublicBaseUrl()
    const suggested = ctx?.suggestedPublicBaseUrl?.trim() || ''
    if (stored) setPublicBaseUrl(stored)
    else if (suggested && !isLikelyLocalhostUrl(suggested)) setPublicBaseUrl(suggested)
    else if (!needsTunnel && origin) setPublicBaseUrl(origin)
  }, [ctx?.suggestedPublicBaseUrl, needsTunnel, origin])

  useEffect(() => {
    if (provider === 'github' && !ghRepo && ctx?.githubRepos[0]) {
      setGhRepo(ctx.githubRepos[0].nameWithOwner)
    }
  }, [ctx, provider, ghRepo])

  const submit = async () => {
    setError(null)
    try {
      const base = publicBaseUrl.trim()
      if (base) storePublicBaseUrl(base)
      const parsed = parseGithubOwnerRepo(ghRepo)
      const result = await install.mutateAsync({
        provider,
        name: meta?.label || provider,
        publicBaseUrl: base,
        automation: { create: false, workspaceId: '', runtimeId: '' },
        ...(provider === 'github' && parsed
          ? { github: { owner: parsed.owner, repo: parsed.repo } }
          : {}),
        ...(provider === 'linear' && linearKey.trim() ? { linear: { apiKey: linearKey } } : {}),
        ...(provider === 'jira'
          ? { jira: { siteUrl: jiraSite, email: jiraEmail, apiToken: jiraToken } }
          : {}),
      })
      onInstalled({
        integrationId: result.integration.id,
        automationId: result.automationId,
        secret: result.integration.secret,
        registeredRemotely: result.registeredRemotely,
        remoteError: result.remoteError,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const Chevron = open ? ChevronDown : ChevronRight

  return (
    <div className="rounded-md border border-[var(--border-quaternary)]">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-ui-sm text-tier-tertiary hover:text-foreground"
        >
          <Chevron className="h-3.5 w-3.5 shrink-0" />
          Set up a webhook yourself instead
        </button>
      ) : (
        <div className="px-3 py-2 text-ui-sm text-tier-tertiary">
          Self-managed webhook — this machine hosts the endpoint.
        </div>
      )}

      {open ? (
        <div className="space-y-4 border-t border-[var(--border-quaternary)] p-3">
          <p className="text-ui-sm text-tier-tertiary">
            {label} posts straight to this machine. It needs a public URL to reach you, and a
            credential if you want Open Run to register the hook for you — both used once, never
            stored.
          </p>

          {needsTunnel ? (
            <Field label="Public base URL" hint="optional — enables one-click register">
              <input
                className={inputClass}
                value={publicBaseUrl}
                onChange={(e) => setPublicBaseUrl(e.target.value)}
                placeholder="https://your-tunnel.example"
                autoComplete="off"
              />
            </Field>
          ) : null}

          {provider === 'github' ? (
            <div className="space-y-2">
              <Field label="Repository" hint="optional">
                {ctx?.githubRepos.length ? (
                  <select
                    className={inputClass}
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    aria-label="GitHub repository"
                  >
                    <option value="">Skip — paste the URL in GitHub</option>
                    {ctx.githubRepos.map((r) => (
                      <option key={r.nameWithOwner} value={r.nameWithOwner}>
                        {r.nameWithOwner}
                        {r.source === 'project' ? ' (project)' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={inputClass}
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    placeholder="owner/repo"
                  />
                )}
              </Field>
              {!ctx?.gh.authenticated ? (
                <p className="text-ui-sm text-tier-tertiary">
                  {ctx?.gh.installed
                    ? '`gh auth login` registers the webhook for you. Otherwise Install still creates an endpoint to paste.'
                    : 'Install creates an endpoint to paste in GitHub. `gh auth login` registers it for you.'}
                </p>
              ) : null}
            </div>
          ) : null}

          {provider === 'linear' ? (
            <Field
              label="Linear API key"
              hint={
                <a href="https://linear.app/settings/api" target="_blank" rel="noreferrer">
                  Settings → API
                </a>
              }
            >
              <input
                className={inputClass}
                type="password"
                value={linearKey}
                onChange={(e) => setLinearKey(e.target.value)}
                placeholder="lin_api_… (optional)"
                autoComplete="off"
              />
            </Field>
          ) : null}

          {provider === 'jira' ? (
            <div className="space-y-4">
              <Field label="Jira site URL">
                <input
                  className={inputClass}
                  value={jiraSite}
                  onChange={(e) => setJiraSite(e.target.value)}
                  placeholder="https://your-site.atlassian.net"
                />
              </Field>
              <Field label="Atlassian email">
                <input
                  className={inputClass}
                  value={jiraEmail}
                  onChange={(e) => setJiraEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                />
              </Field>
              <Field
                label="API token"
                hint={
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Atlassian API tokens
                  </a>
                }
              >
                <input
                  className={inputClass}
                  type="password"
                  value={jiraToken}
                  onChange={(e) => setJiraToken(e.target.value)}
                  placeholder="optional — paste the URL in Jira if skipped"
                  autoComplete="off"
                />
              </Field>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-danger px-3 py-2 text-ui-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={install.isPending}
              onClick={() => void submit()}
            >
              {install.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing…
                </>
              ) : (
                'Create local endpoint'
              )}
            </Button>
            {onCancel ? (
              <Button type="button" variant="ghost" disabled={install.isPending} onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
