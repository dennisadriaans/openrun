/**
 * Connecting a provider.
 *
 * There is one path: **Connect**. The control plane owns the vendor OAuth app,
 * the tokens, and the webhook, so the user approves the app in their browser and
 * events arrive over this machine's outbound relay — nothing to paste, no public
 * URL, no signing secret.
 *
 * What to show is decided by `lib/cloud/providers.ts` rather than here, so the
 * button and the sentence explaining its absence can never disagree.
 */
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { providerMeta } from '../lib/integrations/catalog'
import { planIntegrationConnect } from '../lib/cloud/providers'
import type { IntegrationProviderId } from '../lib/integrations/types'
import {
  useCloudProviders,
  useCloudStatus,
  useStartCloudLogin,
  useStartHostedConnect,
} from '../lib/queries'
import { Button } from './ui'

export function IntegrationConnectPanel({
  provider,
  autoConnect = false,
  onCancel,
  compact = false,
}: {
  provider: IntegrationProviderId
  /** Start the browser hop immediately — set when returning from sign-in. */
  autoConnect?: boolean
  onCancel?: () => void
  /** Button and errors only — for the centered empty state. */
  compact?: boolean
}) {
  const meta = providerMeta(provider)
  const label = meta?.label ?? provider

  const { data: cloud } = useCloudStatus()
  const { data: catalog } = useCloudProviders()
  const startConnect = useStartHostedConnect()
  const startLogin = useStartCloudLogin()
  const [error, setError] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const plan = planIntegrationConnect({
    label,
    cloudUrl: cloud?.cloudUrl ?? null,
    signedIn: Boolean(cloud?.signedIn),
    // `undefined` while the query is in flight — the plan renders "loading"
    // rather than briefly claiming the provider is unavailable.
    catalog: catalog ?? null,
    provider,
  })

  const connect = useCallback(async () => {
    setError(null)
    try {
      const { url } = await startConnect.mutateAsync({ provider, origin })
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [origin, provider, startConnect])

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
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {plan.kind === 'connect' ? (
        <div className="space-y-3">
          {compact ? null : (
            <>
              <p className="text-ui-sm text-tier-secondary">
                Approve Open Run in {label} and you are done. Tokens stay on the control plane; this
                machine receives events over an outbound connection, so there is no tunnel to run
                and no secret to copy.
              </p>
              {plan.picksTarget ? (
                <p className="text-ui-sm text-tier-tertiary">
                  {label} asks which project to watch, so you will pick one before coming back.
                </p>
              ) : null}
            </>
          )}
          {errorBox}
          <div className={compact ? 'flex flex-wrap justify-center gap-2' : 'flex flex-wrap gap-2'}>
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
          <div className={compact ? 'flex flex-wrap justify-center gap-2' : 'flex flex-wrap gap-2'}>
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
          {cancelButton}
        </div>
      ) : null}
    </div>
  )
}
