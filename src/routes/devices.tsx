/**
 * Devices — pair a phone, see what is paired, revoke it.
 *
 * Three states, and the first one matters most: the mobile surface is off by
 * default, because turning it on makes the dev server listen beyond loopback.
 * So the empty state is not "no devices yet", it is "here is the command, and
 * here is what it exposes".
 */
import { createFileRoute } from '@tanstack/react-router'
import { Check, Copy, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

import { Button, Card, EmptyState, Modal, PageHeader } from '../components/ui'
import { relativeTime } from '../lib/format'
import { encodePairingQr, formatPairingCode } from '../lib/pairing'
import {
  useCancelPairing,
  useCreatePairingCode,
  useMobileStatus,
  useRemoveDevice,
  useRevokeDevice,
} from '../lib/queries'

export const Route = createFileRoute('/devices')({ component: DevicesPage })

type DeviceLike = {
  id: string
  name: string
  platform: string
  scope: string
  pushToken: string
  createdAt: number
  lastSeenAt: number | null
  revokedAt: number | null
}

function DevicesPage() {
  const { data: status, isLoading } = useMobileStatus()
  const [pairing, setPairing] = useState<{
    id: string
    code: string
    expiresAt: number
  } | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<DeviceLike | null>(null)

  const createCode = useCreatePairingCode()
  const cancelPairing = useCancelPairing()
  const revoke = useRevokeDevice()
  const remove = useRemoveDevice()

  const devices = (status?.devices ?? []) as DeviceLike[]
  const active = devices.filter((d) => d.revokedAt === null)
  const revoked = devices.filter((d) => d.revokedAt !== null)

  const startPairing = async () => {
    const result = await createCode.mutateAsync()
    setPairing(result)
  }

  const closePairing = () => {
    if (pairing) cancelPairing.mutate(pairing.id)
    setPairing(null)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <PageHeader
        title="Devices"
        description="Control runs and answer approval prompts from your phone."
        actions={
          status?.enabled ? (
            <Button variant="primary" onClick={startPairing} disabled={createCode.isPending}>
              <Smartphone className="size-3.5" />
              Pair a phone
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="text-ui-base text-tier-tertiary">Loading…</div>
      ) : !status?.enabled ? (
        <DisabledState envVar={status?.envVar ?? 'AGENTOPS_MOBILE'} hint={status?.enableHint ?? ''} />
      ) : (
        <div className="space-y-5">
          <ReachabilityCard baseUrls={status.baseUrls} apnsConfigured={status.apnsConfigured} />

          {active.length === 0 ? (
            <EmptyState icon={<Smartphone className="size-6" />} title="No phone paired yet">
              Choose “Pair a phone”, then scan the code from the Open Run app on your
              iPhone. The code is good for five minutes and works once.
            </EmptyState>
          ) : (
            <Card>
              <div className="border-b border-border px-4 py-2.5 text-ui-sm text-tier-tertiary">
                Paired
              </div>
              <ul>
                {active.map((device) => (
                  <DeviceRow
                    key={device.id}
                    device={device}
                    onRevoke={() => setConfirmRevoke(device)}
                  />
                ))}
              </ul>
            </Card>
          )}

          {revoked.length > 0 ? (
            <Card>
              <div className="border-b border-border px-4 py-2.5 text-ui-sm text-tier-tertiary">
                Revoked
              </div>
              <ul>
                {revoked.map((device) => (
                  <li
                    key={device.id}
                    className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ui-base text-tier-tertiary line-through">
                        {device.name}
                      </div>
                      <div className="text-ui-sm text-tier-quaternary">
                        Revoked {relativeTime(device.revokedAt ?? 0)}
                      </div>
                    </div>
                    <Button variant="ghost" onClick={() => remove.mutate(device.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}

      {pairing ? (
        <PairingModal
          code={pairing.code}
          expiresAt={pairing.expiresAt}
          baseUrls={status?.baseUrls ?? []}
          onClose={closePairing}
        />
      ) : null}

      {confirmRevoke ? (
        <Modal title="Revoke this device?" onClose={() => setConfirmRevoke(null)}>
          <p className="text-ui-base text-tier-secondary">
            {confirmRevoke.name} will stop working immediately. Pairing it again needs a
            new code.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmRevoke(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                revoke.mutate(confirmRevoke.id)
                setConfirmRevoke(null)
              }}
            >
              Revoke
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function DisabledState({ envVar, hint }: { envVar: string; hint: string }) {
  return (
    <Card className="p-5">
      <h2 className="text-ui-base text-foreground">Phone access is off</h2>
      <p className="mt-1.5 max-w-2xl text-ui-base text-tier-secondary">
        Start the dev server with <code className="text-foreground">{envVar}=1</code> to
        turn it on:
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-[var(--bg-quaternary)] px-3 py-2 text-ui-sm text-foreground">
        {hint}
      </pre>
      <p className="mt-3 max-w-2xl text-ui-sm text-tier-tertiary">
        This makes the server listen on your local network instead of just this machine.
        Only <code>/api/mobile/…</code> is reachable from other devices, and only with a
        paired token — the rest of Open Run stays refused. On an untrusted network, point
        the phone at an https tunnel rather than the LAN address: a bearer token over
        plain HTTP is readable by anyone on the same Wi‑Fi.
      </p>
    </Card>
  )
}

function ReachabilityCard({
  baseUrls,
  apnsConfigured,
}: {
  baseUrls: string[]
  apnsConfigured: boolean
}) {
  return (
    <Card className="p-4">
      <div className="text-ui-sm text-tier-tertiary">This machine is reachable at</div>
      {baseUrls.length === 0 ? (
        <p className="mt-1.5 text-ui-base text-tier-secondary">
          No local network address found. Connect to Wi‑Fi, or use your own tunnel URL
          when pairing.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {baseUrls.map((url) => (
            <li key={url} className="font-mono text-ui-base text-foreground">
              {url}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-ui-sm text-tier-tertiary">
        {apnsConfigured
          ? 'Push notifications are configured — approval prompts will reach a locked phone.'
          : 'Push is not configured, so approval prompts only arrive while the app is open. A supervised run auto-denies after five minutes. See ios/README.md to set up APNs.'}
      </p>
    </Card>
  )
}

function DeviceRow({ device, onRevoke }: { device: DeviceLike; onRevoke: () => void }) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <Smartphone className="size-4 shrink-0 text-tier-tertiary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui-base text-foreground">{device.name}</div>
        <div className="text-ui-sm text-tier-quaternary">
          Paired {relativeTime(device.createdAt)}
          {device.lastSeenAt ? ` · last seen ${relativeTime(device.lastSeenAt)}` : ''}
          {device.pushToken ? ' · push on' : ' · push off'}
        </div>
      </div>
      <Button variant="danger" onClick={onRevoke}>
        Revoke
      </Button>
    </li>
  )
}

function PairingModal({
  code,
  expiresAt,
  baseUrls,
  onClose,
}: {
  code: string
  expiresAt: number
  baseUrls: string[]
  onClose: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const [qr, setQr] = useState<string>('')
  const [copied, setCopied] = useState(false)

  const base = baseUrls[0] ?? ''
  const payload = useMemo(() => encodePairingQr({ base, code }), [base, code])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!base) return
    let cancelled = false
    // Rendered light-on-dark to match the app; scanners cope with either as
    // long as the contrast holds.
    QRCode.toDataURL(payload, { margin: 1, width: 320 })
      .then((url) => {
        if (!cancelled) setQr(url)
      })
      .catch(() => {
        // No QR is survivable — the code below it is the real path.
      })
    return () => {
      cancelled = true
    }
  }, [payload, base])

  const remaining = Math.max(0, expiresAt - now)
  const expired = remaining === 0
  const mins = Math.floor(remaining / 60_000)
  const secs = Math.floor((remaining % 60_000) / 1000)

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Modal title="Pair a phone" onClose={onClose}>
      {expired ? (
        <p className="text-ui-base text-tier-secondary">
          This code expired. Close this and start again.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {qr ? (
            <img
              src={qr}
              alt="Pairing QR code"
              className="size-56 rounded-lg border border-border bg-white p-2"
            />
          ) : (
            <div className="flex size-56 items-center justify-center rounded-lg border border-border text-ui-sm text-tier-quaternary">
              {base ? 'Rendering…' : 'No LAN address — enter the code manually'}
            </div>
          )}

          <div className="text-center">
            <div className="font-mono text-2xl tracking-[0.2em] text-foreground">
              {formatPairingCode(code)}
            </div>
            <button
              onClick={copy}
              className="mt-1 inline-flex items-center gap-1 text-ui-sm text-tier-tertiary transition-colors hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>

          <div className="text-ui-sm text-tier-quaternary">
            Expires in {mins}:{String(secs).padStart(2, '0')} · works once
          </div>

          <div className="w-full rounded-lg border border-border bg-[var(--bg-quaternary)] px-3 py-2.5 text-ui-sm text-tier-tertiary">
            In the Open Run app, scan this or type the code with the server address.
            {base ? (
              <>
                {' '}
                On this network that is <span className="font-mono text-foreground">{base}</span>.
              </>
            ) : null}{' '}
            Using a tunnel? Enter its https URL on the phone instead — the code is the
            same.
          </div>
        </div>
      )}
    </Modal>
  )
}
