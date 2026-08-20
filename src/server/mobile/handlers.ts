/**
 * Mobile endpoint logic. Route files under `routes/api/mobile/**` stay thin
 * shells over these.
 *
 * Two rules hold the scope boundary:
 *  - everything reaches the app through `server/core.ts`, never past it;
 *  - nothing here imports `server/git.ts` or `server/files.ts` directly, and
 *    the only core calls it makes into either are the **reads**
 *    (`getRunWorkspace`, `getFileDiff`, `listWorkspaceFiles`,
 *    `readWorkspaceFile`). There is no code path from a phone to a commit, a
 *    push, or a file write, whatever a token claims.
 *
 * Core throws on bad input; the boundary converts that into a status.
 */
import { pendingApprovals } from '../../lib/pendingApprovals'
import { mobileScopeSummary } from '../../lib/mobileScope'
import { runNowBlockedReason } from '../../lib/runNowGate'
import type { DeviceRow } from '../db'
import { clearPairAttempts, pairAttemptBlocked, recordPairFailure, RATE_LIMITED } from './auth'
import { redeemPairingCode, registerPushToken, revokeDevice } from './devices'
import { mobileEnabled } from './config'

/**
 * `core.ts` boots the scheduler and pulls in `better-sqlite3`, so it is reached
 * the same way `fns/index.ts` reaches it: lazily, once per call. A static
 * import here would pin it into this module's graph and defeat the code
 * splitting every other entry point relies on.
 */
async function core() {
  return await import('../core')
}

export type MobileResult = {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

const NOT_FOUND: MobileResult = { ok: false, status: 404, body: { error: 'Not found' } }

/** Turn a thrown core error into a 4xx rather than a 500. */
function failed(err: unknown, status = 400): MobileResult {
  const message = err instanceof Error ? err.message : 'Request failed'
  return { ok: false, status, body: { error: message } }
}

function ok(body: Record<string, unknown>): MobileResult {
  return { ok: true, status: 200, body }
}

/** Parse a JSON body without letting a malformed one throw out of the route. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function str(body: Record<string, unknown> | null, key: string): string {
  const value = body?.[key]
  return typeof value === 'string' ? value : ''
}

/** Device shape sent to the phone. Never includes `tokenHash`. */
function publicDevice(device: DeviceRow) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    scope: device.scope,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    pushRegistered: device.pushToken.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Pairing and identity
// ---------------------------------------------------------------------------

export async function handlePair(input: {
  body: Record<string, unknown> | null
  source: string
}): Promise<MobileResult> {
  if (!mobileEnabled()) return NOT_FOUND
  if (pairAttemptBlocked(input.source)) {
    return { ok: false, status: RATE_LIMITED.status, body: RATE_LIMITED.body }
  }
  const code = str(input.body, 'code')
  if (!code) return { ok: false, status: 400, body: { error: 'A pairing code is required.' } }

  const result = redeemPairingCode({
    code,
    deviceName: str(input.body, 'deviceName'),
    platform: str(input.body, 'platform') || 'ios',
  })
  if (!result.ok) {
    recordPairFailure(input.source)
    return { ok: false, status: result.status, body: { error: result.error } }
  }
  clearPairAttempts(input.source)
  return ok({
    token: result.token,
    device: publicDevice(result.device),
    scope: mobileScopeSummary(result.device.scope),
  })
}

export async function handleMe(device: DeviceRow): Promise<MobileResult> {
  return ok({ device: publicDevice(device), scope: mobileScopeSummary(device.scope) })
}

export async function handleRegisterPush(input: {
  device: DeviceRow
  body: Record<string, unknown> | null
}): Promise<MobileResult> {
  const pushToken = str(input.body, 'pushToken')
  if (!pushToken) return { ok: false, status: 400, body: { error: 'A push token is required.' } }
  registerPushToken({
    deviceId: input.device.id,
    pushToken,
    pushEnv: str(input.body, 'env'),
  })
  return ok({ ok: true })
}

/** A device retiring itself — the phone-side "forget this server". */
export async function handleUnpair(device: DeviceRow): Promise<MobileResult> {
  revokeDevice(device.id)
  return ok({ ok: true })
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function handleDashboard(): Promise<MobileResult> {
  const dashboard = (await core()).getDashboard()
  return ok({
    stats: dashboard.stats,
    recentRuns: dashboard.recentRuns,
    pending: dashboard.pending,
  })
}

/** Cap the page size so a phone on cellular cannot ask for everything. */
const MAX_RUN_PAGE = 100

export async function handleListRuns(url: URL): Promise<MobileResult> {
  const rawLimit = Number(url.searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_RUN_PAGE)
    : 50
  const taskId = url.searchParams.get('taskId') ?? undefined
  return ok({
    runs: (await core()).listRuns({
      limit,
      taskId: taskId || undefined,
      includeArchived: url.searchParams.get('includeArchived') === '1',
    }),
  })
}

/**
 * Run detail for the phone.
 *
 * `workspace`, `project` and `workspaces` stay dropped — they drive desktop
 * pickers a phone has no screen for. `models` *is* sent: the composer offers
 * the same model/effort choice as the desktop, and the catalog is what labels
 * it. `pendingApprovals` is added because that is what the phone is here for.
 */
export async function handleGetRun(runId: string): Promise<MobileResult> {
  const conversation = (await core()).getConversation(runId)
  if (!conversation) return NOT_FOUND

  const events = conversation.messages.flatMap((m) => m.events)
  return ok({
    run: conversation.run,
    messages: conversation.messages,
    checkResults: conversation.checkResults,
    verdict: conversation.verdict,
    canFollowUp: conversation.canFollowUp,
    runtime: conversation.runtime,
    runtimeMode: conversation.runtimeMode,
    models: conversation.models,
    model: conversation.model,
    effort: conversation.effort,
    pendingApprovals: pendingApprovals(events),
  })
}

// ---------------------------------------------------------------------------
// Review surface — read-only diff and workspace files
// ---------------------------------------------------------------------------

/**
 * Changed-file summary for the run, plus repo/branch context.
 *
 * `gh` is stripped: it only tells the desktop whether the PR button works, and
 * the phone has no PR button.
 */
export async function handleRunDiff(runId: string): Promise<MobileResult> {
  if (!(await core()).getRun(runId)) return NOT_FOUND
  try {
    const workspace = (await core()).getRunWorkspace(runId)
    if (!workspace) return NOT_FOUND
    return ok({
      files: workspace.files,
      repo: workspace.repo,
      totals: workspace.totals,
      baseBranch: workspace.baseBranch,
    })
  } catch (err) {
    // A worktree that was archived or removed under the run.
    return failed(err, 409)
  }
}

/** Unified diff text for one path, against the run's base snapshot. */
export async function handleRunFileDiff(input: {
  runId: string
  path: string
}): Promise<MobileResult> {
  if (!(await core()).getRun(input.runId)) return NOT_FOUND
  if (!input.path) return { ok: false, status: 400, body: { error: 'A path is required.' } }
  try {
    return ok({ ...(await core()).getFileDiff({ runId: input.runId, path: input.path }) })
  } catch (err) {
    return failed(err, 409)
  }
}

/** One directory level of the run's workspace. */
export async function handleRunFiles(input: { runId: string; dir: string }): Promise<MobileResult> {
  if (!(await core()).getRun(input.runId)) return NOT_FOUND
  try {
    return ok({ ...(await core()).listWorkspaceFiles({ runId: input.runId, dir: input.dir }) })
  } catch (err) {
    // `files.ts` throws on a path that escapes the workspace — that is a
    // rejected request, not a server fault.
    return failed(err, 400)
  }
}

/** File contents for the read-only code viewer. */
export async function handleRunFileContent(input: {
  runId: string
  path: string
}): Promise<MobileResult> {
  if (!(await core()).getRun(input.runId)) return NOT_FOUND
  if (!input.path) return { ok: false, status: 400, body: { error: 'A path is required.' } }
  try {
    return ok({ ...(await core()).readWorkspaceFile({ runId: input.runId, path: input.path }) })
  } catch (err) {
    return failed(err, 400)
  }
}

export async function handleListTasks(): Promise<MobileResult> {
  // Strip the prompt: it can be long, and the phone cannot edit it anyway.
  const tasks = (await core()).listTasks().map((task) => ({
    id: task.id,
    name: task.name,
    runtimeId: task.runtimeId,
    cron: task.cron,
    enabled: task.enabled,
    workspaceId: task.workspaceId,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    queuedCount: task.queuedCount,
    // Why Run now / Enable would refuse, or null when they are clear. Sent so
    // the phone can explain a disabled control instead of failing on tap.
    blockedReason: runNowBlockedReason(task),
  }))
  return ok({ tasks })
}

// ---------------------------------------------------------------------------
// Writes — the narrow set a phone may perform
// ---------------------------------------------------------------------------

export async function handleCancelRun(runId: string): Promise<MobileResult> {
  if (!(await core()).getRun(runId)) return NOT_FOUND
  try {
    ;(await core()).cancelRun(runId)
    return ok({ ok: true })
  } catch (err) {
    return failed(err)
  }
}

export async function handlePostMessage(input: {
  runId: string
  body: Record<string, unknown> | null
}): Promise<MobileResult> {
  if (!(await core()).getRun(input.runId)) return NOT_FOUND
  const prompt = str(input.body, 'prompt')
  try {
    const result = (await core()).postMessage({
      runId: input.runId,
      prompt,
      model: str(input.body, 'model') || undefined,
      effort: str(input.body, 'effort') || undefined,
    })
    return ok({ ...result })
  } catch (err) {
    return failed(err)
  }
}

export async function handleAnswerApproval(input: {
  runId: string
  body: Record<string, unknown> | null
}): Promise<MobileResult> {
  if (!(await core()).getRun(input.runId)) return NOT_FOUND
  const requestId = str(input.body, 'requestId')
  const decision = str(input.body, 'decision')
  if (!requestId) {
    return { ok: false, status: 400, body: { error: 'A requestId is required.' } }
  }
  if (decision !== 'allow' && decision !== 'deny') {
    return { ok: false, status: 400, body: { error: 'Decision must be allow or deny.' } }
  }
  try {
    const result = (await core()).answerApproval({
      runId: input.runId,
      requestId,
      decision,
      message: str(input.body, 'message') || undefined,
    })
    // `answered: false` is not an error — the prompt was already resolved or
    // hit the 5-minute auto-deny. The phone renders that difference.
    return ok({ answered: result.answered })
  } catch (err) {
    return failed(err)
  }
}

export async function handleToggleTask(input: {
  taskId: string
  body: Record<string, unknown> | null
}): Promise<MobileResult> {
  if (!(await core()).getTask(input.taskId)) return NOT_FOUND
  const enabled = input.body?.enabled
  if (typeof enabled !== 'boolean') {
    return { ok: false, status: 400, body: { error: 'enabled must be true or false.' } }
  }
  try {
    ;(await core()).setTaskEnabled(input.taskId, enabled)
    return ok({ id: input.taskId, enabled })
  } catch (err) {
    // Enable refuses on a bad cron / missing workspace / missing binary; that
    // reason is the server's own, not a second gate invented here.
    return failed(err, 409)
  }
}

export async function handleRunTaskNow(taskId: string): Promise<MobileResult> {
  if (!(await core()).getTask(taskId)) return NOT_FOUND
  try {
    return ok({ ...(await core()).runTaskNow(taskId) })
  } catch (err) {
    // Workspace missing / not ready / binary off PATH / empty prompt — the
    // same refuse order `runNowGate` mirrors for the desktop button.
    return failed(err, 409)
  }
}
