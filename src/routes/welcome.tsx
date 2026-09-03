/**
 * First-run screen. Signing in links this machine to an Open Run account so
 * integrations can reach it; skipping keeps every local feature except those.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Cloud, Loader2, ShieldCheck, Webhook } from 'lucide-react'
import { useState } from 'react'
import { Icon } from './__root'
import { useCloudStatus, useSkipCloudOnboarding, useStartCloudLogin } from '../lib/queries'

export const Route = createFileRoute('/welcome')({
  component: WelcomePage,
})

const POINTS = [
  {
    icon: Webhook,
    title: 'One-click integrations',
    body: 'Connect Jira and friends in a browser. No tunnel, no port forwarding, no webhook secrets to copy.',
  },
  {
    icon: Cloud,
    title: 'Events reach this machine',
    body: 'Open Run dials out and holds the connection. Anything that arrives while you are offline is queued.',
  },
  {
    icon: ShieldCheck,
    title: 'Your code stays here',
    body: 'Runs, prompts, and repositories never leave your machine. The account only carries integration events.',
  },
]

function WelcomePage() {
  const navigate = useNavigate()
  const { data: cloud, isPending } = useCloudStatus()
  const startLogin = useStartCloudLogin()
  const skip = useSkipCloudOnboarding()
  const [error, setError] = useState('')

  // Assume available until the status query answers, so the first paint does
  // not claim the cloud is off.
  const cloudAvailable = cloud ? Boolean(cloud.cloudUrl) : true

  const onSignIn = async () => {
    setError('')
    try {
      const { url } = await startLogin.mutateAsync(window.location.origin)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onSkip = async () => {
    await skip.mutateAsync()
    await navigate({ to: '/' })
  }

  return (
    <div className="grid min-h-screen place-items-center bg-chrome px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2">
          <Icon className="size-6 rounded-[5px]" />
          <span className="text-ui-base font-medium tracking-tight text-foreground">Open Run</span>
        </div>

        <h1 className="text-2xl font-medium tracking-tight text-foreground">
          Connect Open Run to your account
        </h1>
        <p className="mt-2 text-ui-sm text-tier-secondary">Free, and it takes about ten seconds.</p>

        <ul className="mt-8 space-y-5">
          {POINTS.map((point) => (
            <li key={point.title} className="flex gap-3">
              <point.icon className="mt-0.5 size-4 shrink-0 text-tier-quaternary" />
              <div>
                <p className="text-ui-sm font-medium text-foreground">{point.title}</p>
                <p className="mt-0.5 text-ui-sm text-tier-secondary">{point.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {error ? <p className="mt-6 text-ui-sm text-red-400">{error}</p> : null}

        <button
          type="button"
          disabled={!cloudAvailable || isPending || startLogin.isPending}
          onClick={() => void onSignIn()}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--base)] px-4 py-2.5 text-ui-sm font-medium text-[var(--actionLabel)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {startLogin.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Sign in or create an account
        </button>

        {isPending || cloudAvailable ? null : (
          <p className="mt-3 text-center text-ui-sm text-tier-tertiary">
            Cloud is disabled by <code className="font-mono">AGENTOPS_CLOUD_URL</code>.
          </p>
        )}

        <p className="mt-5 text-center">
          <button
            type="button"
            onClick={() => void onSkip()}
            disabled={skip.isPending}
            className="text-ui-sm text-tier-quaternary underline-offset-4 transition-colors hover:text-tier-secondary hover:underline disabled:opacity-50"
          >
            Continue without an account
          </button>
        </p>
      </div>
    </div>
  )
}
