/**
 * Notifications.
 *
 * Where a finished run goes when nobody is looking at the app. Each notifier
 * picks which verdicts it cares about; the default (no verdicts selected) is
 * the needs-attention set, so a healthy nightly run stays quiet and a red one
 * reaches you.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  VerdictBadge,
  inputClass,
} from '../components/ui'
import { relativeTime } from '../lib/format'
import { parseVerdictList, resolveNotifierName } from '../lib/notify'
import { ALL_VERDICTS, verdictLabel, type RunVerdict } from '../lib/verdict'
import {
  useNotificationDeliveries,
  useNotifiers,
  useRemoveNotifier,
  useSaveNotifier,
  useTestNotifier,
} from '../lib/queries'

export const Route = createFileRoute('/notifications')({ component: NotificationsPage })

type NotifierRowLike = {
  id: string
  kind: string
  name: string
  target: string
  verdicts: string
  enabled: number
}

function NotificationsPage() {
  const { data: notifiers, isLoading } = useNotifiers()
  const { data: deliveries } = useNotificationDeliveries()
  const [editing, setEditing] = useState<NotifierRowLike | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<NotifierRowLike | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; detail: string } | null>(
    null,
  )

  const save = useSaveNotifier()
  const remove = useRemoveNotifier()
  const test = useTestNotifier()

  const runTest = async (id: string) => {
    setTestResult(null)
    const result = await test.mutateAsync(id)
    setTestResult({ id, ...result })
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <PageHeader
        title="Notifications"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        }
      />

      <div>
        {isLoading ? (
          <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
        ) : notifiers && notifiers.length > 0 ? (
          <Card className="divide-y divide-[var(--border-quaternary)]">
            {notifiers.map((n) => {
              const verdicts = parseVerdictList(n.verdicts)
              return (
                <div key={n.id} className="group/row px-4 py-3 transition-colors hover:bg-hover">
                  <div className="flex items-start justify-between gap-4">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditing(n)}
                      aria-label={`Edit ${n.name}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-ui-base text-foreground">{n.name}</span>
                        {n.enabled === 0 ? (
                          <span className="text-ui-sm text-tier-quaternary">disabled</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-ui-sm text-tier-tertiary">
                        {n.kind === 'webhook' ? n.target : 'Desktop notification'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {verdicts.length === 0 ? (
                          <span className="text-ui-sm text-tier-tertiary">
                            Only when a run needs attention
                          </span>
                        ) : (
                          verdicts.map((v) => <VerdictBadge key={v} verdict={v} />)
                        )}
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        disabled={test.isPending}
                        title="Send a test notification"
                        aria-label={`Test ${n.name}`}
                        onClick={() => runTest(n.id)}
                      >
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        title="Delete notifier"
                        aria-label={`Delete ${n.name}`}
                        onClick={() => setDeleteTarget(n)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {testResult?.id === n.id ? (
                    <p
                      className={`mt-2 rounded-md border border-border px-3 py-1.5 text-ui-sm ${
                        testResult.ok ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {testResult.ok ? 'Test notification delivered.' : testResult.detail}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </Card>
        ) : (
          <EmptyState title="No notifiers" />
        )}
      </div>

      <section className="mt-8">
        <div className="mb-1.5 text-ui-xs font-medium uppercase tracking-wider text-tier-quaternary">
          Deliveries
        </div>
        <Card className="divide-y divide-[var(--border-quaternary)]">
          {deliveries && deliveries.length > 0 ? (
            deliveries.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-ui-sm text-tier-secondary">
                    <Link
                      to="/runs/$runId"
                      params={{ runId: d.runId }}
                      className="mono text-tier-secondary underline underline-offset-2 hover:text-foreground"
                    >
                      {d.runId}
                    </Link>
                    <span className="text-tier-quaternary"> · </span>
                    <span>{resolveNotifierName(d.notifierName, d.notifierId)}</span>
                    <span className="text-tier-quaternary"> · </span>
                    <span>{verdictLabel(d.verdict as RunVerdict) || d.verdict}</span>
                  </div>
                  {d.detail && d.status === 'error' ? (
                    <div className="mt-0.5 truncate text-ui-sm text-danger">{d.detail}</div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-ui-sm">
                  <span className={d.status === 'ok' ? 'text-success' : 'text-danger'}>
                    {d.status}
                  </span>
                  <span className="text-tier-quaternary">{relativeTime(d.sentAt)}</span>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-ui-sm text-tier-quaternary">
              No deliveries yet.
            </div>
          )}
        </Card>
      </section>

      {creating || editing ? (
        <NotifierModal
          notifier={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSave={async (input) => {
            await save.mutateAsync(input)
            setCreating(false)
            setEditing(null)
          }}
          saving={save.isPending}
        />
      ) : null}

      {deleteTarget ? (
        <Modal title="Delete notifier" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <p className="text-ui-base text-tier-secondary">
              Delete <span className="text-foreground">{deleteTarget.name}</span>? Runs will no
              longer be reported to this destination.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={async () => {
                  await remove.mutateAsync(deleteTarget.id)
                  setDeleteTarget(null)
                }}
              >
                {remove.isPending ? 'Deleting…' : 'Delete notifier'}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function NotifierModal({
  notifier,
  onClose,
  onSave,
  saving,
}: {
  notifier: NotifierRowLike | null
  onClose: () => void
  onSave: (input: {
    id?: string
    kind: 'webhook' | 'desktop'
    name: string
    target?: string
    verdicts: RunVerdict[]
    enabled: boolean
  }) => Promise<void>
  saving: boolean
}) {
  const [kind, setKind] = useState<'webhook' | 'desktop'>(
    (notifier?.kind as 'webhook' | 'desktop') ?? 'webhook',
  )
  const [name, setName] = useState(notifier?.name ?? '')
  const [target, setTarget] = useState(notifier?.target ?? '')
  const [verdicts, setVerdicts] = useState<RunVerdict[]>(parseVerdictList(notifier?.verdicts))
  const [enabled, setEnabled] = useState(notifier ? notifier.enabled === 1 : true)
  const [error, setError] = useState('')

  const toggleVerdict = (v: RunVerdict) => {
    setVerdicts((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))
  }

  const submit = async () => {
    setError('')
    try {
      await onSave({ id: notifier?.id, kind, name, target, verdicts, enabled })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title={notifier ? `Edit ${notifier.name}` : 'Add notifier'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Destination">
          <div className="flex gap-2">
            {(['webhook', 'desktop'] as const).map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => setKind(k)}
                className={`rounded-md border px-3 py-1.5 text-ui-base transition-colors ${
                  kind === k
                    ? 'border-border-strong bg-hover text-foreground'
                    : 'border-border text-tier-secondary hover:bg-hover'
                }`}
              >
                {k === 'webhook' ? 'Webhook' : 'Desktop notification'}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Name">
          <input
            className={inputClass}
            placeholder={kind === 'webhook' ? 'Team chat' : 'This machine'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {kind === 'webhook' ? (
          <Field label="Webhook URL" hint="Discord webhook bodies are detected from the host">
            <input
              className={`${inputClass} mono`}
              placeholder="https://example.com/hooks/…"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
        ) : null}

        <Field
          label="Notify on"
          hint={verdicts.length === 0 ? 'default: only when attention is needed' : undefined}
        >
          <div className="flex flex-wrap gap-1.5">
            {ALL_VERDICTS.map((v) => {
              const on = verdicts.includes(v)
              return (
                <button
                  type="button"
                  key={v}
                  onClick={() => toggleVerdict(v)}
                  className={`rounded-full border px-2.5 py-0.5 text-ui-sm transition-colors ${
                    on
                      ? 'border-border-strong bg-hover text-foreground'
                      : 'border-border text-tier-tertiary hover:bg-hover'
                  }`}
                >
                  {verdictLabel(v)}
                </button>
              )
            })}
          </div>
        </Field>

        <label className="flex cursor-pointer items-center gap-2 text-ui-base text-tier-secondary">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--base)]"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>

        {error ? (
          <p className="rounded-md border border-border px-3 py-2 text-ui-base text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Save notifier'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
