/**
 * One-click provider install.
 *
 * Two routes in. **Connect** hands the browser to the control plane, which owns
 * the vendor OAuth app and the webhook — nothing to paste, and no public URL
 * needed because events arrive over this machine's outbound relay. **Set up
 * locally** is the self-hosted path: it creates a local endpoint immediately and
 * registers the remote webhook when a public URL and credentials are present.
 *
 * GitLab, Bitbucket, and Azure DevOps have no local verify/parse
 * implementation, so Connect is the only route for them.
 */
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { providerMeta } from '../lib/integrations/catalog'
import {
  isLikelyLocalhostUrl,
  parseGithubOwnerRepo,
  readStoredPublicBaseUrl,
  storePublicBaseUrl,
} from '../lib/integrations/install'
import type { IntegrationProviderId } from '../lib/integrations/types'
import {
  useInstallContext,
  useInstallIntegration,
  useCloudStatus,
  useStartHostedConnect,
} from '../lib/queries'
import { Button, Field, inputClass } from './ui'

export function IntegrationInstallPanel({
  provider,
  onCancel,
  onInstalled,
}: {
  provider: IntegrationProviderId
  onCancel?: () => void
  onInstalled: (result: {
    integrationId: string
    automationId: string | null
    secret?: string
    registeredRemotely: boolean
    remoteError?: string
  }) => void
}) {
  const meta = providerMeta(provider)
  const { data: ctx, isLoading: ctxLoading } = useInstallContext()
  const install = useInstallIntegration()
  const { data: cloud } = useCloudStatus()
  const startConnect = useStartHostedConnect()
  const [localSetup, setLocalSetup] = useState(false)

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
          ? {
              jira: {
                siteUrl: jiraSite,
                email: jiraEmail,
                apiToken: jiraToken,
              },
            }
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

  const connect = async () => {
    setError(null)
    try {
      const { url } = await startConnect.mutateAsync({ provider, origin })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!meta) return null

  if (ctxLoading) {
    return <p className="text-ui-sm text-tier-tertiary">Loading…</p>
  }

  const hostedOnly = !meta.supportsLocalInstall
  const signedIn = Boolean(cloud?.signedIn)
  const showHosted = signedIn && !localSetup
  const showLocal = !hostedOnly && (localSetup || !signedIn)
  const errorBox = error ? (
    <p className="rounded-md border border-danger px-3 py-2 text-ui-sm text-danger">{error}</p>
  ) : null

  if (hostedOnly && !signedIn) {
    return (
      <div className="space-y-3">
        <p className="text-ui-sm text-tier-secondary">
          {meta.label} connects through your Open Run account. Sign in from the sidebar, then come
          back and click Connect — there is nothing to paste and no public URL to set up.
        </p>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showLocal && needsTunnel ? (
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

      {showHosted ? (
        <div className="space-y-3">
          <p className="text-ui-sm text-tier-secondary">
            Connect {meta.label} in the browser. Tokens stay on the control plane; this machine
            receives events over an outbound connection.
          </p>
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
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…
                </>
              ) : (
                `Connect ${meta.label}`
              )}
            </Button>
            {hostedOnly ? null : (
              <Button type="button" variant="ghost" onClick={() => setLocalSetup(true)}>
                Set up locally
              </Button>
            )}
            {onCancel ? (
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showLocal && provider === 'github' ? (
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

      {showLocal && provider === 'linear' ? (
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

      {showLocal && provider === 'jira' ? (
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

      {showLocal ? (
        <>
          {errorBox}

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
                'Install'
              )}
            </Button>
            {signedIn && localSetup ? (
              <Button type="button" variant="ghost" onClick={() => setLocalSetup(false)}>
                Back
              </Button>
            ) : null}
            {onCancel ? (
              <Button type="button" variant="ghost" disabled={install.isPending} onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
