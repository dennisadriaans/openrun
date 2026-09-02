/**
 * Notification delivery.
 *
 * Fired once per run when it reaches a terminal status (see the run-finalized
 * hook in `core.ts`). The decision of *whether* to notify and *what to say*
 * lives in `lib/notify.ts`; this module owns the side effects — POSTing a
 * webhook, raising an OS notification — and the delivery log.
 *
 * Delivery is deliberately fire-and-forget: a notifier that is down must never
 * hold up a run or throw into the executor's close handler.
 */
import { spawn } from 'node:child_process'
import { isFailingOutcome, latestPass } from '../lib/checkPass.ts'
import { openrunEnv } from '../lib/openrunEnv.ts'
import {
  assertWebhookUrl,
  buildFireRefusalNotification,
  buildRunNotification,
  detectWebhookShape,
  fireRefusalWebhookPayload,
  isRefusedFireOutcome,
  notifierMatches,
  REFUSED_DELIVERY_VERDICT,
  notifierMatchesRefusal,
  parseVerdictList,
  shouldNotifyRefusal,
  webhookPayload,
  type FireRefusalNotification,
  type NotifierKind,
  type RunNotification,
} from '../lib/notify.ts'
import { parseVerdict, type RunVerdict } from '../lib/verdict.ts'
import {
  getDb,
  type CheckResultRow,
  type NotificationDeliveryRow,
  type NotifierRow,
  type RunRow,
} from './db.ts'
import { isSealed, revealString, sealString, secretAad } from './secretBox.ts'

/** Where the app is reachable, for the links inside notifications. */
function appBaseUrl(): string {
  return openrunEnv('BASE_URL') || 'http://localhost:3000'
}

const DELIVERY_TIMEOUT_MS = 10_000

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

function revealNotifier(row: NotifierRow): NotifierRow {
  const target = revealString(row.target, secretAad('notifier.target', row.id))
  if (row.target && !isSealed(row.target) && target) {
    getDb()
      .prepare('UPDATE notifiers SET target = ? WHERE id = ?')
      .run(sealString(target, secretAad('notifier.target', row.id)), row.id)
  }
  return { ...row, target }
}

export function listNotifiers(): NotifierRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifiers ORDER BY createdAt ASC')
    .all() as NotifierRow[]
  return rows.map(revealNotifier)
}

export function getNotifier(notifierId: string): NotifierRow | undefined {
  const row = getDb().prepare('SELECT * FROM notifiers WHERE id = ?').get(notifierId) as
    | NotifierRow
    | undefined
  return row ? revealNotifier(row) : undefined
}

export type NotifierInput = {
  id?: string
  kind: NotifierKind
  name: string
  /** Required for `webhook`; ignored for `desktop`. */
  target?: string
  verdicts?: RunVerdict[]
  enabled: boolean
}

export function upsertNotifier(input: NotifierInput): NotifierRow {
  if (input.kind !== 'webhook' && input.kind !== 'desktop') {
    throw new Error('A notifier is either a webhook or a desktop notification.')
  }
  const name = input.name.trim()
  if (!name) throw new Error('Give the notifier a name so you can tell them apart.')

  // Validate on save rather than discovering at 3am that the URL was a typo.
  const target = input.kind === 'webhook' ? assertWebhookUrl(input.target ?? '') : ''

  const db = getDb()
  const nid = input.id ?? id('ntf')
  const existing = getNotifier(nid)
  const now = Date.now()
  db.prepare(
    `INSERT INTO notifiers (id, kind, name, target, verdicts, enabled, createdAt, updatedAt)
     VALUES (@id, @kind, @name, @target, @verdicts, @enabled, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       kind=@kind, name=@name, target=@target, verdicts=@verdicts,
       enabled=@enabled, updatedAt=@updatedAt`,
  ).run({
    id: nid,
    kind: input.kind,
    name,
    target: sealString(target, secretAad('notifier.target', nid)),
    verdicts: JSON.stringify(input.verdicts ?? []),
    enabled: input.enabled ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  return getNotifier(nid)!
}

export function deleteNotifier(notifierId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM notification_deliveries WHERE notifierId = ?').run(notifierId)
  db.prepare('DELETE FROM notifiers WHERE id = ?').run(notifierId)
}

/** Delivery row plus the notifier's display name for the Notifications list. */
export type NotificationDeliveryListItem = NotificationDeliveryRow & {
  notifierName: string
}

export function listNotificationDeliveries(opts?: {
  notifierId?: string
  limit?: number
}): NotificationDeliveryListItem[] {
  const limit = opts?.limit ?? 25
  const db = getDb()
  const select = `SELECT d.id, d.notifierId, d.runId, d.verdict, d.status, d.detail, d.sentAt,
                         COALESCE(n.name, '') AS notifierName
                  FROM notification_deliveries d
                  LEFT JOIN notifiers n ON n.id = d.notifierId`
  return (
    opts?.notifierId
      ? db
          .prepare(`${select} WHERE d.notifierId = ? ORDER BY d.sentAt DESC LIMIT ?`)
          .all(opts.notifierId, limit)
      : db.prepare(`${select} ORDER BY d.sentAt DESC LIMIT ?`).all(limit)
  ) as NotificationDeliveryListItem[]
}

function recordDelivery(input: {
  notifierId: string
  /** Empty for a refused fire — no run was ever created. */
  runId: string
  verdict: RunVerdict | typeof REFUSED_DELIVERY_VERDICT
  status: 'ok' | 'error'
  detail?: string
}) {
  getDb()
    .prepare(
      `INSERT INTO notification_deliveries (id, notifierId, runId, verdict, status, detail, sentAt)
       VALUES (@id, @notifierId, @runId, @verdict, @status, @detail, @sentAt)`,
    )
    .run({
      id: id('nd'),
      notifierId: input.notifierId,
      runId: input.runId,
      verdict: input.verdict,
      status: input.status,
      detail: (input.detail ?? '').slice(0, 2_000),
      sentAt: Date.now(),
    })
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

async function postWebhook(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
}

function deliverWebhook(url: string, notification: RunNotification): Promise<void> {
  return postWebhook(url, webhookPayload(notification, detectWebhookShape(url), appBaseUrl()))
}

/**
 * Raise an OS notification with whatever the platform provides. There is no
 * dependency to add here — every desktop OS ships something — and a missing
 * binary is reported as a failed delivery rather than crashing the run.
 */
function deliverDesktop(notification: { title: string; body: string }): Promise<void> {
  const { title, body } = notification
  const [bin, args] =
    process.platform === 'darwin'
      ? [
          'osascript',
          [
            '-e',
            `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
          ],
        ]
      : process.platform === 'win32'
        ? [
            'powershell',
            [
              '-NoProfile',
              '-Command',
              `[reflection.assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; ` +
                `$n = New-Object System.Windows.Forms.NotifyIcon; ` +
                `$n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; ` +
                `$n.ShowBalloonTip(10000, ${JSON.stringify(title)}, ${JSON.stringify(body)}, 'Info')`,
            ],
          ]
        : ['notify-send', [title, body]]

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, { stdio: 'ignore' })
    } catch (err) {
      reject(new Error(`${bin}: ${String(err)}`))
      return
    }
    child.on('error', (err) => reject(new Error(`${bin}: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${bin} exited ${code}`))
    })
  })
}

async function deliver(notifier: NotifierRow, notification: RunNotification): Promise<void> {
  try {
    if (notifier.kind === 'webhook') await deliverWebhook(notifier.target, notification)
    else await deliverDesktop(notification)
    recordDelivery({
      notifierId: notifier.id,
      runId: notification.runId,
      verdict: notification.verdict,
      status: 'ok',
    })
  } catch (err) {
    recordDelivery({
      notifierId: notifier.id,
      runId: notification.runId,
      verdict: notification.verdict,
      status: 'error',
      detail: String(err),
    })
  }
}

/** Blocking checks that failed in the run's most recent verification pass. */
function failedCheckNames(runId: string): string[] {
  const rows = getDb()
    .prepare('SELECT * FROM check_results WHERE runId = ? ORDER BY attempt ASC, startedAt ASC')
    .all(runId) as CheckResultRow[]
  return latestPass(rows)
    .filter((r) => r.blocking === 1 && isFailingOutcome(r.outcome))
    .map((r) => r.name)
}

/**
 * Notify every matching destination that a run has settled. Called from the
 * executor's run-finalized hook — never awaited by the caller, and never
 * throws: a broken notifier must not take a finished run down with it.
 */
export function notifyRunFinished(runId: string, changedFiles: number): void {
  let notifiers: NotifierRow[]
  try {
    notifiers = listNotifiers().filter((n) => n.enabled === 1)
  } catch {
    return
  }
  if (notifiers.length === 0) return

  const run = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined
  if (!run) return

  const verdict = parseVerdict(run.verdict)
  const matching = notifiers.filter((n) =>
    notifierMatches({ enabled: n.enabled === 1, verdicts: parseVerdictList(n.verdicts) }, verdict),
  )
  if (matching.length === 0) return

  const notification = buildRunNotification({
    runId: run.id,
    taskName: run.taskName,
    verdict,
    trigger: run.trigger,
    durationMs: Math.max(0, (run.finishedAt ?? Date.now()) - run.startedAt),
    changedFiles,
    failedChecks: failedCheckNames(runId),
    repairAttempts: run.repairAttempts ?? 0,
  })

  for (const notifier of matching) {
    void deliver(notifier, notification)
  }
}

// ---------------------------------------------------------------------------
// Refused scheduled fires
// ---------------------------------------------------------------------------

async function deliverRefusal(
  notifier: NotifierRow,
  notification: FireRefusalNotification,
): Promise<void> {
  try {
    if (notifier.kind === 'webhook') {
      await postWebhook(
        notifier.target,
        fireRefusalWebhookPayload(notification, detectWebhookShape(notifier.target), appBaseUrl()),
      )
    } else {
      await deliverDesktop(notification)
    }
    // No run row exists for a refusal — the fire never became one. An empty
    // runId is what the deliveries list reads as "this was not about a run".
    recordDelivery({
      notifierId: notifier.id,
      runId: '',
      verdict: REFUSED_DELIVERY_VERDICT,
      status: 'ok',
    })
  } catch (err) {
    recordDelivery({
      notifierId: notifier.id,
      runId: '',
      verdict: REFUSED_DELIVERY_VERDICT,
      status: 'error',
      detail: String(err),
    })
  }
}

/**
 * Tell every enabled notifier that a scheduled fire was refused.
 *
 * Notifiers only ever fired on a finished *run*, so an automation that was
 * refused before it started — a dirty worktree, a logged-out `gh`, a missing
 * runtime — failed in total silence, every day, until somebody happened to
 * open the Automations page. This is the other half of that story.
 *
 * Never throws and never awaited by the scheduler: a notifier that is down
 * must not take a fire record down with it.
 */
export function notifyScheduleFireRefused(input: {
  taskId: string
  outcome: string
  detail: string
  scheduledFor: number
  /** The fire recorded immediately before this one, for de-duplication. */
  previous: { outcome: string; detail: string } | null
}): void {
  if (!isRefusedFireOutcome(input.outcome)) return
  if (!shouldNotifyRefusal(input)) return

  let notifiers: NotifierRow[]
  try {
    notifiers = listNotifiers().filter((n) =>
      notifierMatchesRefusal({ enabled: n.enabled === 1, verdicts: parseVerdictList(n.verdicts) }),
    )
  } catch {
    return
  }
  if (notifiers.length === 0) return

  const task = getDb().prepare('SELECT name FROM tasks WHERE id = ?').get(input.taskId) as
    | { name: string }
    | undefined

  const notification = buildFireRefusalNotification({
    taskId: input.taskId,
    taskName: task?.name ?? '',
    outcome: input.outcome,
    detail: input.detail,
    scheduledFor: input.scheduledFor,
  })

  for (const notifier of notifiers) void deliverRefusal(notifier, notification)
}

/** Send a fixed sample through one notifier so the user can prove it works. */
export async function testNotifier(notifierId: string): Promise<{ ok: boolean; detail: string }> {
  const notifier = getNotifier(notifierId)
  if (!notifier) throw new Error('Notifier not found')

  const notification = buildRunNotification({
    runId: 'run_test',
    taskName: 'Open Run test notification',
    verdict: 'failed-checks',
    trigger: 'manual',
    durationMs: 95_000,
    changedFiles: 3,
    failedChecks: ['Types'],
    repairAttempts: 1,
  })

  try {
    if (notifier.kind === 'webhook') await deliverWebhook(notifier.target, notification)
    else await deliverDesktop(notification)
    recordDelivery({
      notifierId: notifier.id,
      runId: 'run_test',
      verdict: 'failed-checks',
      status: 'ok',
      detail: 'test',
    })
    return { ok: true, detail: 'Delivered' }
  } catch (err) {
    const detail = String(err)
    recordDelivery({
      notifierId: notifier.id,
      runId: 'run_test',
      verdict: 'failed-checks',
      status: 'error',
      detail,
    })
    return { ok: false, detail }
  }
}
