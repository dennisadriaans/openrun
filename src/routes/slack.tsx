/**
 * Slack.
 *
 * Setup for the phone-shaped control surface: paste two tokens, name a
 * channel, and list who is allowed to drive runs. The connection is Socket Mode
 * — an outbound websocket — so this works from a laptop behind NAT with no
 * tunnel, which is the point.
 *
 * The allowlist is the security control, and it defaults to empty (nobody).
 * The page says so rather than letting a blank field read as "everyone".
 */
import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Loader2, Send, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IntegrationPage, IntegrationStatusBanner } from '../components/IntegrationPage'
import { Button, Card, Field, inputClass } from '../components/ui'
import { normalizeUserIds } from '../lib/slack/gate'
import { SLACK_HELP_LINES } from '../lib/slack/commands'
import {
  useSaveSlackSettings,
  useSlackSettings,
  useSlackStatus,
  useTestSlackConnection,
} from '../lib/queries'

export const Route = createFileRoute('/slack')({ component: SlackPage })

/** Shown in a token field that already holds a saved value. */
const KEPT = '••••••••••••'

function SlackPage() {
  const { data: settings, isLoading } = useSlackSettings()
  const { data: status } = useSlackStatus()
  const save = useSaveSlackSettings()
  const test = useTestSlackConnection()

  const [botToken, setBotToken] = useState('')
  const [appToken, setAppToken] = useState('')
  const [signingSecret, setSigningSecret] = useState('')
  const [channelId, setChannelId] = useState('')
  const [allowed, setAllowed] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [notifyOnFinish, setNotifyOnFinish] = useState(true)
  const [notifyOnApproval, setNotifyOnApproval] = useState(true)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Seed the form once the saved settings land. Secrets come back redacted, so
  // the fields show a placeholder and an untouched field means "keep it".
  useEffect(() => {
    if (!settings) return
    setChannelId(settings.channelId)
    setAllowed(settings.allowedUserIds.join(', '))
    setEnabled(settings.enabled)
    setNotifyOnFinish(settings.notifyOnFinish)
    setNotifyOnApproval(settings.notifyOnApproval)
    setBotToken(settings.hasBotToken ? KEPT : '')
    setAppToken(settings.hasAppToken ? KEPT : '')
    setSigningSecret(settings.hasSigningSecret ? KEPT : '')
  }, [settings])

  const allowedCount = normalizeUserIds([allowed]).length

  const onSave = async () => {
    setTestResult(null)
    await save.mutateAsync({
      // An untouched placeholder means "unchanged" — never overwrite a live
      // token with the dots we rendered.
      botToken: botToken === KEPT ? '' : botToken,
      appToken: appToken === KEPT ? '' : appToken,
      signingSecret: signingSecret === KEPT ? '' : signingSecret,
      channelId,
      allowedUserIds: allowed,
      enabled,
      notifyOnFinish,
      notifyOnApproval,
    })
  }

  const onTest = async () => {
    setTestResult(null)
    const result = await test.mutateAsync()
    setTestResult({ ok: result.ok, message: result.message })
  }

  if (isLoading) {
    return (
      <IntegrationPage title="Slack">
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      </IntegrationPage>
    )
  }

  const banner = status ? describe(status) : null

  return (
    <IntegrationPage
      title="Slack"
      actions={
        <>
          <Button variant="ghost" disabled={test.isPending} onClick={onTest}>
            {test.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Test
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={onSave}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {banner ? <IntegrationStatusBanner tone={banner.tone} text={banner.text} /> : null}

      {testResult ? (
        <div
          className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-ui-sm ${
            testResult.ok
              ? 'border-[var(--border-quaternary)] text-tier-secondary'
              : 'border-danger text-danger'
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      ) : null}

      <Card className="space-y-4 p-4">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            <span className="text-ui-base text-foreground">Control runs from Slack</span>
            <span className="mt-0.5 block text-ui-sm text-tier-tertiary">
              Opens an outbound connection to Slack. No public URL or tunnel needed.
            </span>
          </span>
        </label>

        <Field
          label="Bot token"
          hint={<a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Slack app → OAuth</a>}
        >
          <input
            className={inputClass}
            value={botToken}
            placeholder="xoxb-…"
            onChange={(e) => setBotToken(e.target.value)}
            onFocus={(e) => e.target.value === KEPT && setBotToken('')}
          />
        </Field>

        <Field label="App-level token" hint="Basic Information → App-Level Tokens">
          <input
            className={inputClass}
            value={appToken}
            placeholder="xapp-…"
            onChange={(e) => setAppToken(e.target.value)}
            onFocus={(e) => e.target.value === KEPT && setAppToken('')}
          />
        </Field>

        <Field label="Channel" hint="Where run announcements go">
          <input
            className={inputClass}
            value={channelId}
            placeholder="C01234567"
            onChange={(e) => setChannelId(e.target.value)}
          />
        </Field>

        <Field
          label="Allowed Slack members"
          hint={
            allowedCount === 0 ? (
              <span className="text-danger">empty allows nobody</span>
            ) : (
              `${allowedCount} allowed`
            )
          }
        >
          <input
            className={inputClass}
            value={allowed}
            placeholder="U01234567, U89ABCDEF"
            onChange={(e) => setAllowed(e.target.value)}
          />
        </Field>
        <p className="-mt-2 text-ui-sm text-tier-tertiary">
          Runs execute real commands in your repos with your credentials, so only these members can
          steer them. Find an ID in Slack under profile → More → Copy member ID.
        </p>

        <div className="space-y-2 border-t border-[var(--border-quaternary)] pt-4">
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={notifyOnFinish}
              onChange={(e) => setNotifyOnFinish(e.target.checked)}
            />
            <span className="text-ui-sm text-tier-secondary">Post when a run finishes</span>
          </label>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={notifyOnApproval}
              onChange={(e) => setNotifyOnApproval(e.target.checked)}
            />
            <span className="text-ui-sm text-tier-secondary">
              Post when a supervised run needs approval (it auto-denies after 5 minutes)
            </span>
          </label>
        </div>

        <details className="border-t border-[var(--border-quaternary)] pt-4">
          <summary className="cursor-pointer text-ui-sm text-tier-tertiary">
            Signing secret — only needed for the HTTP fallback
          </summary>
          <div className="mt-3">
            <Field label="Signing secret" hint="Basic Information → App Credentials">
              <input
                className={inputClass}
                value={signingSecret}
                placeholder="Only if you point Slack at a public URL"
                onChange={(e) => setSigningSecret(e.target.value)}
                onFocus={(e) => e.target.value === KEPT && setSigningSecret('')}
              />
            </Field>
            <p className="mt-2 text-ui-sm text-tier-tertiary">
              Socket Mode does not need this. Set it only if you expose{' '}
              <code>/api/slack/events</code> and <code>/api/slack/interactions</code> through a
              tunnel.
            </p>
          </div>
        </details>
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="mb-2 text-ui-base text-foreground">What you can say</h2>
        <dl className="space-y-1.5">
          {SLACK_HELP_LINES.map(([command, what]) => (
            <div key={command} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-ui-sm text-foreground">
                <code>{command}</code>
              </dt>
              <dd className="text-ui-sm text-tier-tertiary">— {what}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-ui-sm text-tier-tertiary">
          DM the bot, or mention it in a channel. Replying inside a run’s thread sends that run
          another turn — no command needed. If the run is still working, the message is held and
          delivered the moment the turn ends.
        </p>
      </Card>
    </IntegrationPage>
  )
}

function describe(status: {
  configured: boolean
  enabled: boolean
  connected: boolean
  teamName: string
  lastError: string
  allowedUserCount: number
}): { tone: 'good' | 'bad' | 'idle'; text: string } {
  if (!status.enabled) return { tone: 'idle', text: 'Slack control is off.' }
  if (status.connected) {
    return {
      tone: 'good',
      text: `Connected to ${status.teamName || 'Slack'} · ${status.allowedUserCount} member(s) allowed.`,
    }
  }
  if (status.lastError) return { tone: 'bad', text: status.lastError }
  if (!status.configured) return { tone: 'bad', text: 'Add both tokens and an allowlist to connect.' }
  return { tone: 'idle', text: 'Connecting…' }
}
