/**
 * Process executor.
 *
 * Spawns a runtime's CLI (claude / codex / grok / gemini / fx) as a local child
 * process, streaming stdout/stderr incrementally into the DB so the UI can tail
 * it live. Everything runs locally against the user's own CLI logins — no API
 * tokens, no cloud.
 *
 * A run is a conversation: the first turn is the task prompt, and follow-up
 * turns resume the same agent session (see `resume.ts`). Each turn is stored as
 * a pair of `messages` rows (the user prompt and the assistant reply), while the
 * run row keeps the concatenated stdout/stderr for the raw log view.
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDb, type CheckResultRow, type MessageRow, type RuntimeRow, type TaskRow } from './db'
import { changedFiles, currentBranch, captureBaseSnapshot } from './git'
import {
  buildTurnCommand,
  extractSessionId,
  parseAssistantText,
  eventKindFor,
  runtimeKind,
  supportsResume,
} from './resume'
import { publishActivityLive } from './activityLive'
import { publishRunLive } from './runLive'
import { createTurnUsageSink } from './turnUsage'
import { pushApprovalRequest, pushApprovalSettled } from './mobile/apns'
import {
  AssistantDeltaCoalescer,
  ClaudeStdoutIngest,
  LineBuffer,
  assistantTextFromEvents,
  hasEventAdapter,
  isPlainCliOutput,
  parseTurnEventLine,
  type ParsedTurnEvent,
  type TurnEventRow,
} from './turnEvents'
import { assertWorkspaceFree, resolveWorkspacePath } from './workspaces'
import { recordRunOutcomeForWorkspace } from './workspaceHealth'
import { missingRunCwdMessage } from '../lib/workspaceHealth.ts'
import { isMessageId } from '../lib/messageId.ts'
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, type RuntimeMode } from '../lib/runtimeMode'
import type { TurnEventPayload } from '../lib/turnEvents'
import { assertWorkspaceId } from '../lib/workspaceRef'
import {
  APPROVAL_TIMEOUT_MS,
  assertSupervisedAllowed,
  assertSupervisedSupported,
} from '../lib/supervisedPolicy'
import { buildControlResponse, type ApprovalDecision } from '../lib/claudeControl'
import { resolveApprovalAnswer } from '../lib/approvals'
import type { PermissionOption, ToolKind } from '../lib/acp'
import { isAcpTransport } from '../lib/acpTransport'
import { startAcpTurn } from './acpTurn'
import { protocolMcpServers } from './mcp.ts'
import { OPENRUN_APP_DIR_ENV, OPENRUN_RUN_ID_ENV } from '../lib/openrunTools.ts'
import { withPrCapability } from '../lib/prCapability'
import { buildHandoffPrompt, handoffSystemNote, type HandoffMessage } from '../lib/handoffPrompt.ts'
import { isRuntimeSwitch, resolveSwitchMode, resolveSwitchModel } from '../lib/runtimeSwitch.ts'
import { cachedModelsForBin } from './modelCatalog.ts'
import { describeEffectiveTurnSettings } from '../lib/runSettingsDebug.ts'
import { detectGhFailure } from '../lib/ghOutcome'
import { assertRuntimeOnPath } from './runtimePath'
import { nativeSessionExists } from './nativeSessions'
import { importNativeTranscript } from './nativeImport'
import {
  missingNativeSessionMessage,
  nativeResumeKindFor,
  nativeResumeNotSupportedMessage,
} from '../lib/nativeSessions.ts'
import { checksForWorkspace, clearCheckPass, runCheckPass } from './checks'
import {
  RUN_KILL_GRACE_MS,
  RUN_STALL_AFTER_MS,
  RUN_STALL_CHECK_MS,
  TURN_DONE_LINGER_MS,
  resolveRunTimeoutMs,
  runStalledMessage,
  runTimedOutMessage,
} from '../lib/runBudget'
import { isUsageLimitMessage, usageLimitStopMessage } from '../lib/agentLimits.ts'
import { meaningfulStderr } from '../lib/stderrNoise.ts'
import {
  buildRepairPrompt,
  deriveVerdict,
  shouldAttemptRepair,
  type CheckOutcome,
  type FailedCheckSummary,
  type RunVerdict,
} from '../lib/verdict'
import {
  agentSpawnOptions,
  isPidAlive,
  isShuttingDown,
  killChildTree,
  killPidTree,
  releaseWorkspaceCancellation,
  reserveWorkspaceCancellation,
  setShuttingDown,
} from './processControl'
import { peekQueuedMessage, removeQueuedMessage } from './messageQueue'

/**
 * Live process handles must survive Vite HMR. The scheduler already parks its
 * jobs on globalThis for the same reason — if `live` were a plain module
 * binding, a hot reload of this file would drop every handle while the CLI
 * child kept burning tokens, and Cancel would only flip the DB row.
 */
type ApprovalAnswer = {
  /** ACP option the user picked, when the prompt offered a list. */
  optionId?: string
  /** Plain allow/deny — what auto-deny and older clients send. */
  decision?: ApprovalDecision
  reason?: string
  message?: string
}

type ApprovalController = {
  answer: (requestId: string, answer: ApprovalAnswer) => boolean
  hasPending: () => boolean
}

type LiveChild = ReturnType<typeof spawn>

type LiveHandle = {
  child: LiveChild
  /** Cooperative stop (ACP `session/cancel`); CLI turns omit this. */
  requestStop?: () => void
}

const g = globalThis as unknown as {
  __agentopsLive?: Map<string, LiveHandle>
  __agentopsApprovals?: Map<string, ApprovalController>
  __agentopsVerifying?: Map<string, AbortController>
  __agentopsCancellationPending?: Map<
    string,
    { workspaceId: string; trigger: string; taskName: string; drainQueue: boolean }
  >
  __agentopsShutdownHooks?: boolean
  __agentopsDrainOnExit?: Set<string>
}

function liveMap(): Map<string, LiveHandle> {
  if (!g.__agentopsLive) g.__agentopsLive = new Map()
  return g.__agentopsLive
}

function childOf(live: LiveHandle | undefined): LiveChild | undefined {
  if (!live) return undefined
  return live.child ?? (live as unknown as LiveChild)
}

function approvalsMap(): Map<string, ApprovalController> {
  if (!g.__agentopsApprovals) g.__agentopsApprovals = new Map()
  return g.__agentopsApprovals
}

function verifyingMap(): Map<string, AbortController> {
  if (!g.__agentopsVerifying) g.__agentopsVerifying = new Map()
  return g.__agentopsVerifying
}

function cancellationMap(): Map<
  string,
  { workspaceId: string; trigger: string; taskName: string; drainQueue: boolean }
> {
  if (!g.__agentopsCancellationPending) g.__agentopsCancellationPending = new Map()
  return g.__agentopsCancellationPending
}

/**
 * Runs cancelled *in order to* deliver a queued message ("send now"), rather
 * than to stop working. The queue drains once the agent process is actually
 * gone — resuming a session while the old child is still writing to it is how
 * you corrupt one.
 */
function drainOnExitSet(): Set<string> {
  if (!g.__agentopsDrainOnExit) g.__agentopsDrainOnExit = new Set()
  return g.__agentopsDrainOnExit
}

/**
 * Answer a pending tool-approval request for a supervised run.
 *
 * The answer is expressed the ACP way — the id of the option the user picked —
 * with a plain allow/deny accepted as a fallback. How that reaches the agent
 * depends on the transport: a `control_response` on stdin for a Claude CLI
 * turn, a JSON-RPC response for an ACP turn. Returns false when the run has no
 * such pending request (already resolved, timed out, or finished).
 */
export function answerApproval(input: {
  runId: string
  requestId: string
  optionId?: string
  decision?: ApprovalDecision
  message?: string
}): boolean {
  const controller = approvalsMap().get(input.runId)
  if (!controller) return false
  return controller.answer(input.requestId, {
    optionId: input.optionId,
    decision: input.decision,
    message: input.message,
  })
}

function randomId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function runtimeSupportsLastResume(bin: string) {
  return (bin.split(/[\\/]/).pop() ?? bin).includes('codex')
}

function publishRunStatus(runId: string, status: string, exitCode: number | null) {
  const db = getDb()
  const run = db.prepare('SELECT sessionId, runtimeId FROM runs WHERE id = ?').get(runId) as
    | { sessionId: string; runtimeId: string }
    | undefined
  const runtime = run
    ? (db.prepare('SELECT bin, transport FROM runtimes WHERE id = ?').get(run.runtimeId) as
        | { bin: string; transport: string }
        | undefined)
    : undefined
  const canFollowUp =
    status !== 'running' &&
    !!runtime &&
    supportsResume(runtime.bin, runtime.transport) &&
    ((run?.sessionId.length ?? 0) > 0 || runtimeSupportsLastResume(runtime.bin))
  publishRunLive(runId, { type: 'status', status, exitCode, canFollowUp })
}

export type StartRunInput = {
  runtime: RuntimeRow
  taskId: string | null
  taskName: string
  /** Stored as the user message in the conversation. */
  prompt: string
  /**
   * When set, the CLI receives this instead of `prompt` (before any PR
   * appendix). Planner uses it so chat shows the goal while the child gets
   * the full planning instructions.
   */
  cliPrompt?: string
  cwd: string
  workspaceId: string
  trigger: 'manual' | 'schedule' | 'planner' | 'chat' | 'webhook'
  model?: string
  effort?: string
  runtimeMode?: RuntimeMode | string
  /** Per-turn wall-clock budget in ms; 0 / omitted = the app default. */
  timeoutMs?: number
  /**
   * When false, `workspaceId` is stored on the run (e.g. planner install target)
   * but the CLI keeps `cwd` and the worktree is not locked. Default true.
   */
  lockWorkspace?: boolean
  /**
   * Resume this native CLI session on the opening turn instead of minting a
   * new UUID. Empty / omitted = start a new conversation.
   */
  resumeSessionId?: string
  /** Picker title for the system stub on an adopted native chat. */
  resumeSessionLabel?: string
  /**
   * The ticket a webhook fired for. Stored on the opening user message so the
   * UI can link back to it — deliberately not in `prompt`, because a bare URL
   * makes agents try to open it instead of reading the body they already have.
   */
  source?: MessageSource
}

export type MessageSource = { provider: string; url: string; label: string }

/**
 * Create a run row and spawn the first turn. Returns the run id immediately;
 * the process continues in the background, appending output until exit.
 */
export function startRun(input: StartRunInput): string {
  const db = getDb()
  const runId = randomId('run')
  const now = Date.now()

  // A workspace-backed run must not share its worktree with another running
  // process — check BEFORE inserting the run row so a rejected start never
  // leaves a queued/running row behind. Legacy callers (workspaceId='') keep
  // the old cwd-or-process.cwd() fallback untouched. Planner stores a target
  // workspaceId for install cards but does not lock or chdir into it.
  const lockWorkspace = input.lockWorkspace !== false
  let cwd: string
  if (input.workspaceId && input.workspaceId.trim().length > 0 && lockWorkspace) {
    assertWorkspaceFree(input.workspaceId)
    cwd = resolveWorkspacePath(input.workspaceId)
  } else {
    cwd = input.cwd && input.cwd.trim().length > 0 ? input.cwd : process.cwd()
  }
  assertRunCwdExists(cwd)

  // Claude and Grok let us choose the session id up front, which avoids having
  // to parse it back out of the output before the user can send a follow-up.
  // ACP hands us a session id from `session/new`, so we must not invent one.
  // A native resume reuses the Claude Code UUID and treats the opening turn as
  // a follow-up (`--resume`) so the TUI chat continues instead of a new one.
  const kind = runtimeKind(input.runtime.bin)
  const resumeSessionId = input.resumeSessionId?.trim() ?? ''
  const resumeKind = nativeResumeKindFor(input.runtime)
  if (resumeSessionId) {
    if (!resumeKind) {
      throw new Error(nativeResumeNotSupportedMessage())
    }
    if (!nativeSessionExists(cwd, resumeKind, resumeSessionId)) {
      throw new Error(missingNativeSessionMessage(resumeKind))
    }
  }
  const sessionId = resumeSessionId
    ? resumeSessionId
    : !isAcpTransport(input.runtime.transport) && (kind === 'claude' || kind === 'grok')
      ? randomUUID()
      : ''
  const isFollowUp = resumeSessionId.length > 0

  const model = input.model?.trim() ?? ''
  const effort = input.effort?.trim() ?? ''
  const runtimeMode = parseRuntimeMode(input.runtimeMode ?? DEFAULT_RUNTIME_MODE)

  // A supervised run needs someone to answer approval prompts; refuse to start
  // one on a schedule so an unattended child cannot hang on a control_request.
  assertSupervisedAllowed(input.trigger, runtimeMode)
  // …and something on the other end able to ask in the first place.
  assertSupervisedSupported({
    bin: input.runtime.bin,
    transport: input.runtime.transport,
    mode: runtimeMode,
  })

  // Missing CLI used to create a failed run with spawn ENOENT in stderr —
  // refuse before inserting so "Run now" / schedules fail with a clear error.
  assertRuntimeOnPath(input.runtime.bin)

  // When the runtime is allowed to open PRs, append the shipping instruction to
  // the CLI prompt only — the stored user message stays the user's own text.
  // Planner runs never inherit the PR appendix (JSON-only, no shipping).
  const cliPrompt = withPrCapability(
    input.cliPrompt ?? input.prompt,
    input.trigger !== 'planner' && (input.runtime as { canOpenPrs?: number }).canOpenPrs === 1,
    runtimeMode,
  )

  const turn = buildTurnCommand({
    runtime: input.runtime,
    prompt: cliPrompt,
    cwd,
    sessionId,
    isFollowUp,
    model,
    effort,
    runtimeMode,
    // Planner only needs plain JSON text — don't force stream-json/--json.
    machineReadable: input.trigger !== 'planner',
  })
  if (isFollowUp && !turn.canResume) {
    throw new Error(`The "${input.runtime.label}" runtime does not support resuming a conversation`)
  }

  const baseBranch = currentBranch(cwd)

  db.prepare(
    `INSERT INTO runs (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid, exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot, model, effort, runtimeMode)
     VALUES (@id, @taskId, @taskName, @runtimeId, @trigger, 'running', @command, @cwd, @workspaceId, NULL, NULL, '', '', @startedAt, NULL, @sessionId, @baseBranch, @baseSnapshot, @model, @effort, @runtimeMode)`,
  ).run({
    id: runId,
    taskId: input.taskId,
    taskName: input.taskName,
    runtimeId: input.runtime.id,
    trigger: input.trigger,
    command: turn.display,
    cwd,
    workspaceId: input.workspaceId ?? '',
    startedAt: now,
    sessionId,
    baseBranch,
    baseSnapshot: captureBaseSnapshot(cwd),
    model,
    effort,
    runtimeMode,
  })

  if (input.taskId) {
    db.prepare('UPDATE tasks SET lastRunAt = ? WHERE id = ?').run(now, input.taskId)
  }

  // Automation runs get a settings stub read back off the argv the CLI is about
  // to receive, so a setting that silently failed to reach it is visible in the
  // transcript instead of being echoed back from the automation row.
  if (input.taskId && input.trigger !== 'chat' && input.trigger !== 'planner') {
    db.prepare(
      `INSERT INTO messages (id, runId, role, content, stdout, stderr, status, exitCode, diffSummary, createdAt, finishedAt)
       VALUES (?, ?, 'system', ?, '', '', 'success', NULL, '', ?, ?)`,
    ).run(
      randomId('msg'),
      runId,
      describeEffectiveTurnSettings({
        bin: input.runtime.bin,
        args: turn.args,
        extraEnv: turn.extraEnv,
        prompt: turn.acpPrompt,
        branch: baseBranch,
        cwd,
      }),
      now - 2,
      now - 2,
    )
  }

  // Adopting a chat brings its history with it where we can read the CLI's
  // session file; where we cannot, this is still just the provenance note.
  if (resumeSessionId) {
    importNativeTranscript({
      runId,
      cwd,
      kind: resumeKind ?? 'claude',
      sessionId: resumeSessionId,
      label: input.resumeSessionLabel ?? '',
      before: now,
    })
  }

  publishActivityLive({ type: 'run_changed', runId, status: 'running' })
  spawnTurn({
    runId,
    runtime: input.runtime,
    cwd,
    prompt: input.prompt,
    turn,
    timeoutMs: resolveRunTimeoutMs(input.timeoutMs),
    // Only scheduler/webhook openings are unattended. Manual "Run now" and
    // chat openings are attended workflows; treating every opening as AFK
    // would quarantine a human's own checkout after an ordinary conversation.
    unattended: input.trigger === 'schedule' || input.trigger === 'webhook',
    ...(input.source ? { source: input.source } : {}),
  })
  return runId
}

/**
 * Adopt a saved CLI chat as a run without prompting anything.
 *
 * The point is to read: the transcript lands in a finished run so the whole
 * conversation is browsable in Open Run, and the composer's next message is the
 * first turn Open Run actually executes (resumed on the same CLI, or handed off
 * to another one). Runtimes with no transcript reader still get a run — with
 * the provenance note alone — because resuming them works regardless.
 */
export function adoptNativeChat(input: {
  runtime: RuntimeRow
  taskName: string
  workspaceId: string
  cwd: string
  sessionId: string
  sessionLabel: string
  model?: string
  effort?: string
  runtimeMode?: RuntimeMode | string
}): string {
  const db = getDb()
  const runId = randomId('run')
  const now = Date.now()

  // No child process runs here, so the workspace is read, not locked.
  const cwd =
    input.workspaceId.trim().length > 0
      ? resolveWorkspacePath(input.workspaceId)
      : input.cwd && input.cwd.trim().length > 0
        ? input.cwd
        : process.cwd()

  const sessionId = input.sessionId.trim()
  const kind = nativeResumeKindFor(input.runtime)
  if (!sessionId) throw new Error('Pick a saved chat to open')
  if (!kind) throw new Error(nativeResumeNotSupportedMessage())
  if (!nativeSessionExists(cwd, kind, sessionId)) {
    throw new Error(missingNativeSessionMessage(kind))
  }

  const runtimeMode = parseRuntimeMode(input.runtimeMode ?? DEFAULT_RUNTIME_MODE)
  db.prepare(
    `INSERT INTO runs (id, taskId, taskName, runtimeId, trigger, status, command, cwd, workspaceId, pid, exitCode, stdout, stderr, startedAt, finishedAt, sessionId, baseBranch, baseSnapshot, model, effort, runtimeMode)
     VALUES (@id, NULL, @taskName, @runtimeId, 'chat', 'success', @command, @cwd, @workspaceId, NULL, 0, '', '', @startedAt, @finishedAt, @sessionId, @baseBranch, @baseSnapshot, @model, @effort, @runtimeMode)`,
  ).run({
    id: runId,
    taskName: input.taskName,
    runtimeId: input.runtime.id,
    // Nothing was executed here; the first real command line lands on the
    // follow-up turn, and the log drawer hides an empty one.
    command: '',
    cwd,
    workspaceId: input.workspaceId ?? '',
    startedAt: now,
    finishedAt: now,
    sessionId,
    baseBranch: currentBranch(cwd),
    // The diff a follow-up shows starts here, not at whatever the CLI did.
    baseSnapshot: captureBaseSnapshot(cwd),
    model: input.model?.trim() ?? '',
    effort: input.effort?.trim() ?? '',
    runtimeMode,
  })

  const imported = importNativeTranscript({
    runId,
    cwd,
    kind,
    sessionId,
    label: input.sessionLabel,
    before: now,
  })
  db.prepare('UPDATE runs SET startedAt = ? WHERE id = ?').run(imported.startedAt, runId)

  publishActivityLive({ type: 'run_changed', runId, status: 'success' })
  return runId
}

/**
 * Send a follow-up message on an existing run, resuming the agent session.
 * Returns the user/assistant message ids so the client can seed the chat cache
 * before the first SSE frames arrive.
 */
export function sendFollowUp(input: {
  runId: string
  prompt: string
  /**
   * Continue the conversation on a different runtime. Sessions are per-CLI and
   * opaque, so this is a handoff: a new session on the new binary, seeded with
   * a summary of the transcript (see `lib/handoffPrompt.ts`).
   */
  runtimeId?: string
  model?: string
  effort?: string
  runtimeMode?: RuntimeMode | string
  timeoutMs?: number
  userMessageId?: string
  assistantMessageId?: string
  /**
   * Internal repair turns resume a run the executor is still holding: the run
   * row is legitimately `running` and this very run owns the workspace lock,
   * so both guards below would refuse a turn that is perfectly safe. It is
   * also what separates an unattended turn from a human-typed one, which is
   * how `concludeTurn` knows not to verify.
   */
  internal?: boolean
}): { userMessageId: string; assistantMessageId: string } {
  const db = getDb()
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(input.runId) as
    | {
        runtimeId: string
        cwd: string
        sessionId: string
        status: string
        workspaceId: string
        model: string
        effort: string
        runtimeMode: string
        baseSnapshot: string
      }
    | undefined
  if (!run) throw new Error('Run not found')
  assertRunCwdExists(run.cwd)
  if (!input.internal && run.status === 'running') {
    throw new Error('This run is still working — wait for it to finish')
  }

  // A follow-up still writes into the same tree as the first turn — another
  // run must not be mid-edit in that workspace when we resume this one.
  if (!input.internal && run.workspaceId && run.workspaceId.trim().length > 0) {
    assertWorkspaceFree(run.workspaceId)
  }

  const switching = isRuntimeSwitch(run.runtimeId, input.runtimeId)
  const readRuntime = db.prepare('SELECT * FROM runtimes WHERE id = ?')
  const runtime = readRuntime.get(switching ? input.runtimeId!.trim() : run.runtimeId) as
    | RuntimeRow
    | undefined
  if (!runtime) throw new Error('Runtime not found for this run')
  const previous = switching ? (readRuntime.get(run.runtimeId) as RuntimeRow | undefined) : runtime

  // Same preflight as startRun — don't flip the run back to running if the
  // binary disappeared between turns.
  assertRuntimeOnPath(runtime.bin)

  let model = input.model?.trim() ?? run.model ?? ''
  let effort = input.effort?.trim() ?? run.effort ?? ''
  let runtimeMode = parseRuntimeMode(input.runtimeMode ?? run.runtimeMode ?? DEFAULT_RUNTIME_MODE)
  if (switching) {
    // A slug and an access mode from the old CLI mean nothing to the new one.
    const picked = resolveSwitchModel(cachedModelsForBin(runtime.bin), model)
    if (picked.model !== model) {
      model = picked.model
      effort = picked.effort
    }
    runtimeMode = resolveSwitchMode(runtimeMode, runtime)
  }

  assertSupervisedSupported({ bin: runtime.bin, transport: runtime.transport, mode: runtimeMode })

  // The stored user message stays the user's own text; only the CLI sees the
  // handoff summary in front of it.
  const cliPrompt = switching
    ? buildHandoffPrompt({
        fromLabel: previous?.label ?? 'another runtime',
        toLabel: runtime.label,
        messages: handoffTranscript(input.runId),
        files: handoffChangedFiles(run.cwd, run.baseSnapshot),
        prompt: input.prompt,
      })
    : input.prompt

  const turn = buildTurnCommand({
    runtime,
    prompt: cliPrompt,
    cwd: run.cwd,
    // A handoff cannot resume anything — the new CLI has never seen this chat.
    sessionId: switching ? '' : run.sessionId,
    isFollowUp: !switching,
    model,
    effort,
    runtimeMode,
  })
  if (!switching && !turn.canResume) {
    throw new Error(`The "${runtime.label}" runtime does not support resuming a conversation`)
  }

  if (switching) {
    db.prepare("UPDATE runs SET runtimeId = ?, sessionId = '', command = ? WHERE id = ?").run(
      runtime.id,
      turn.display,
      input.runId,
    )
    const at = Date.now() - 1
    db.prepare(
      `INSERT INTO messages (id, runId, role, content, stdout, stderr, status, exitCode, diffSummary, createdAt, finishedAt)
       VALUES (?, ?, 'system', ?, '', '', 'success', NULL, '', ?, ?)`,
    ).run(
      randomId('msg'),
      input.runId,
      handoffSystemNote(previous?.label ?? 'another runtime', runtime.label),
      at,
      at,
    )
  }

  // A new turn re-opens the question of whether the run's work is good, so the
  // previous verdict is cleared rather than left showing a stale judgement.
  db.prepare(
    "UPDATE runs SET status = 'running', finishedAt = NULL, model = ?, effort = ?, runtimeMode = ?, verdict = '', timedOut = 0 WHERE id = ?",
  ).run(model, effort, runtimeMode, input.runId)

  publishActivityLive({ type: 'run_changed', runId: input.runId, status: 'running' })

  return spawnTurn({
    runId: input.runId,
    runtime,
    cwd: run.cwd,
    prompt: input.prompt,
    turn,
    timeoutMs: resolveRunTimeoutMs(input.timeoutMs),
    unattended: input.internal === true,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
  })
}

/** Transcript replayed to a runtime taking over the conversation. */
function handoffTranscript(runId: string): HandoffMessage[] {
  const rows = getDb()
    .prepare('SELECT id, role, content FROM messages WHERE runId = ? ORDER BY createdAt ASC')
    .all(runId) as Array<{ id: string; role: string; content: string }>

  return rows.flatMap((row) => {
    if (row.role !== 'user' && row.role !== 'assistant') return []
    // Assistant text lives in turn events whenever the runtime had an adapter;
    // `content` is only populated for plain-CLI runs.
    const content =
      row.role === 'assistant' && !row.content.trim()
        ? assistantTextFromEvents(listTurnEventsForMessage(row.id))
        : row.content
    if (!content.trim()) return []
    return [{ role: row.role, content }]
  })
}

/** Paths the run has already touched, so the new agent reads before editing. */
function handoffChangedFiles(cwd: string, baseSnapshot: string): string[] {
  try {
    return changedFiles(cwd, baseSnapshot || undefined).map((file) => file.path)
  } catch {
    return []
  }
}

/**
 * Env every agent process gets on top of the runtime's own.
 *
 * `OPENRUN_RUN_ID` is what makes Open Run's MCP server (`scripts/mcp-server.ts`)
 * answer for *this* run: the CLI inherits it and passes it down to any MCP
 * server it spawns, so the tools need no handshake of their own.
 */
/** Refuse before spawn when the run's working directory is not on disk. */
function assertRunCwdExists(cwd: string): void {
  if (!existsSync(cwd)) throw new Error(missingRunCwdMessage(cwd))
}

function turnEnv(runId: string, extraEnv?: Record<string, string>): Record<string, string> {
  return {
    ...(extraEnv ?? {}),
    [OPENRUN_RUN_ID_ENV]: runId,
    [OPENRUN_APP_DIR_ENV]: process.cwd(),
  }
}

type TurnCommand = ReturnType<typeof buildTurnCommand>

/**
 * Record the user/assistant message pair for a turn and spawn the process that
 * fills in the assistant reply. Returns both message ids for cache seeding.
 */
function spawnTurn(input: {
  runId: string
  runtime: RuntimeRow
  cwd: string
  prompt: string
  turn: TurnCommand
  /** Wall-clock budget for this turn; already resolved to a concrete value. */
  timeoutMs: number
  /**
   * False for a turn a human typed. Only unattended turns are verified —
   * see `concludeTurn`.
   */
  unattended: boolean
  /** Origin badge for the user message; only webhook turns carry one. */
  source?: MessageSource
  userMessageId?: string
  assistantMessageId?: string
}): { userMessageId: string; assistantMessageId: string } {
  const { runId, runtime, cwd, prompt, turn, timeoutMs, unattended, source } = input
  const db = getDb()
  const now = Date.now()

  const userMsgId = isMessageId(input.userMessageId ?? '') ? input.userMessageId! : randomId('msg')
  const assistantMsgId = isMessageId(input.assistantMessageId ?? '')
    ? input.assistantMessageId!
    : randomId('msg')

  const insertMessage = db.prepare(
    `INSERT INTO messages (id, runId, role, content, stdout, stderr, status, exitCode, diffSummary, sourceProvider, sourceUrl, sourceLabel, createdAt, finishedAt)
     VALUES (@id, @runId, @role, @content, '', '', @status, NULL, '', @sourceProvider, @sourceUrl, @sourceLabel, @createdAt, @finishedAt)`,
  )
  insertMessage.run({
    id: userMsgId,
    runId,
    role: 'user',
    content: prompt,
    status: 'success',
    sourceProvider: source?.provider ?? '',
    sourceUrl: source?.url ?? '',
    sourceLabel: source?.label ?? '',
    createdAt: now,
    finishedAt: now,
  })
  insertMessage.run({
    id: assistantMsgId,
    runId,
    role: 'assistant',
    content: '',
    status: 'running',
    sourceProvider: '',
    sourceUrl: '',
    sourceLabel: '',
    createdAt: now + 1,
    finishedAt: null,
  })

  // ACP runtimes are driven over JSON-RPC instead of by parsing stdout, so the
  // whole prompt-file / argv / line-buffer apparatus below does not apply.
  if (isAcpTransport(runtime.transport)) {
    try {
      spawnAcpTurn({
        runId,
        runtime,
        cwd,
        prompt: turn.acpPrompt ?? prompt,
        sessionId: turn.acpSessionId ?? '',
        args: turn.args,
        extraEnv: turn.extraEnv,
        assistantMsgId,
        timeoutMs,
        unattended,
      })
    } catch (err) {
      // Same contract as the CLI path: a spawn that never gets off the ground
      // closes the run out here rather than leaving the row `running` forever.
      const message = `Failed to start ACP agent "${runtime.bin}": ${String(err)}\n`
      db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?').run(message, runId)
      publishRunLive(runId, {
        type: 'log',
        stream: 'stderr',
        chunk: message,
        messageId: assistantMsgId,
      })
      finalizeMessage(assistantMsgId, 'error', null, cwd)
      finalizeRun(runId, 'error', null, 'crashed')
      return { userMessageId: userMsgId, assistantMessageId: assistantMsgId }
    }
    publishRunLive(runId, {
      type: 'turn_started',
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      prompt,
      createdAt: now,
    })
    return { userMessageId: userMsgId, assistantMessageId: assistantMsgId }
  }

  let child: ReturnType<typeof spawn>
  let promptFileDir: string | null = null
  let spawnArgs = turn.args
  let displayCommand = turn.display

  try {
    if (turn.promptFileContents != null || spawnArgs.some((a) => a.includes('{promptFile}'))) {
      promptFileDir = mkdtempSync(join(tmpdir(), 'agentops-prompt-'))
      const promptPath = join(promptFileDir, 'prompt.txt')
      writeFileSync(promptPath, turn.promptFileContents ?? prompt, 'utf8')
      spawnArgs = spawnArgs.map((a) => a.replaceAll('{promptFile}', promptPath))
      displayCommand = `${runtime.bin} ${spawnArgs
        .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
        .join(' ')}`
      getDb()
        .prepare('UPDATE runs SET command = ? WHERE id = ? AND command LIKE ?')
        .run(displayCommand, runId, '%{promptFile}%')
    }

    child = spawn(runtime.bin, spawnArgs, agentSpawnOptions(cwd, turnEnv(runId, turn.extraEnv)))
  } catch (err) {
    if (promptFileDir) {
      try {
        rmSync(promptFileDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup failure
      }
    }
    const message = `Failed to spawn "${runtime.bin}": ${String(err)}\n`
    db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?').run(message, runId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: message,
      messageId: assistantMsgId,
    })
    finalizeMessage(assistantMsgId, 'error', null, cwd)
    finalizeRun(runId, 'error', null, 'crashed')
    return { userMessageId: userMsgId, assistantMessageId: assistantMsgId }
  }

  liveMap().set(runId, { child })
  db.prepare('UPDATE runs SET pid = ? WHERE id = ?').run(child.pid ?? null, runId)

  const appendRunStdout = db.prepare('UPDATE runs SET stdout = stdout || ? WHERE id = ?')
  const appendRunStderr = db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?')
  const appendMsgStdout = db.prepare('UPDATE messages SET stdout = stdout || ? WHERE id = ?')
  const appendMsgStderr = db.prepare('UPDATE messages SET stderr = stderr || ? WHERE id = ?')

  // Wall-clock budget. Without one, a wedged CLI holds this run `running` and
  // keeps the workspace lock forever — every later scheduled fire for that
  // workspace is then refused, and only restarting the app clears it.
  let budgetTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    budgetTimer = null
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled' || cancellationMap().has(runId)) return
    const note = `\n[executor] ${runTimedOutMessage(timeoutMs)}\n`
    appendRunStderr.run(note, runId)
    appendMsgStderr.run(note, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: note,
      messageId: assistantMsgId,
    })
    // Recorded before the kill so the close handler can tell an over-budget
    // stop apart from an ordinary non-zero exit.
    db.prepare('UPDATE runs SET timedOut = 1 WHERE id = ?').run(runId)
    killChildTree(child, { graceMs: RUN_KILL_GRACE_MS })
  }, timeoutMs)

  const noteTurn = (text: string) => {
    appendRunStderr.run(text, runId)
    appendMsgStderr.run(text, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: text,
      messageId: assistantMsgId,
    })
  }

  // Silence watchdog. The budget above only fires at the very end, so a CLI
  // that goes quiet — Codex waiting out a usage limit does exactly that —
  // otherwise spins the transcript with no explanation until it elapses.
  let lastOutputAt = Date.now()
  let stallNotes = 0
  let stallTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const silentMs = Date.now() - lastOutputAt
    const due = Math.floor(silentMs / RUN_STALL_AFTER_MS)
    if (due <= stallNotes) return
    stallNotes = due
    noteTurn(`\n[executor] ${runStalledMessage(silentMs)}\n`)
  }, RUN_STALL_CHECK_MS)

  // A turn that ended on an error can leave the CLI lingering with nothing
  // left to say; without this the run stays `running` until its budget.
  let lingerTimer: ReturnType<typeof setTimeout> | null = null

  const clearBudget = () => {
    if (budgetTimer) clearTimeout(budgetTimer)
    budgetTimer = null
    if (stallTimer) clearInterval(stallTimer)
    stallTimer = null
    if (lingerTimer) clearTimeout(lingerTimer)
    lingerTimer = null
  }

  const kind = eventKindFor(runtimeKind(runtime.bin))
  const lineBuffer = new LineBuffer()
  // Plain / text output (planner Grok) is not JSONL — skip line→event parsing so
  // chat gets one assistant answer from stdout instead of a raw pill per line.
  const structuredEvents = hasEventAdapter(kind) && !isPlainCliOutput(spawnArgs)
  // Grok streams token-sized `text` deltas; coalesce so chat gets prose, not
  // one event per word. Claude/Codex already emit whole messages.
  const grokCoalescer = structuredEvents && kind === 'grok' ? new AssistantDeltaCoalescer() : null
  const claudeIngest = structuredEvents && kind === 'claude' ? new ClaudeStdoutIngest() : null
  let eventSeq = 0
  const insertEvent = db.prepare(
    `INSERT INTO turn_events (id, messageId, runId, seq, kind, payload, createdAt)
     VALUES (@id, @messageId, @runId, @seq, @kind, @payload, @createdAt)`,
  )

  // Supervised (approval-required) state: outstanding tool-approval requests
  // keyed by control-protocol request id, each with an auto-deny timer and the
  // options the prompt offered (so an answer can name one).
  const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const approvalOptions = new Map<string, PermissionOption[]>()
  const toolCallsById = new Map<
    string,
    {
      name?: string
      toolKind?: ToolKind
      callRole?: TurnEventPayload['callRole']
      mcpServer?: string
    }
  >()

  const recordUsage = createTurnUsageSink(db, runId, assistantMsgId)

  const persistEvents = (events: ParsedTurnEvent[]) => {
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled' || cancellationMap().has(runId)) return
    for (const ev of events) {
      // A gauge, not a transcript row: fold it onto the message and move on.
      if (ev.kind === 'usage') {
        recordUsage(ev.payload.usage)
        continue
      }
      if (ev.kind === 'tool_start' && ev.payload.toolCallId) {
        toolCallsById.set(ev.payload.toolCallId, {
          name: ev.payload.name,
          toolKind: ev.payload.toolKind,
          callRole: ev.payload.callRole,
          mcpServer: ev.payload.mcpServer,
        })
      }
      // A settling update usually carries only the id and a status, so backfill
      // what the transcript needs to render the pill from the opening call.
      if (ev.kind === 'tool_result' && ev.payload.toolCallId) {
        const opened = toolCallsById.get(ev.payload.toolCallId)
        if (opened) {
          if (!ev.payload.name) ev.payload.name = opened.name
          if (!ev.payload.toolKind) ev.payload.toolKind = opened.toolKind
          if (!ev.payload.callRole) ev.payload.callRole = opened.callRole
          if (!ev.payload.mcpServer) ev.payload.mcpServer = opened.mcpServer
        }
      }
      if (ev.kind === 'approval_request' && ev.payload.requestId) {
        approvalOptions.set(ev.payload.requestId, ev.payload.options ?? [])
      }

      eventSeq += 1
      const id = randomId('tev')
      const createdAt = Date.now()
      const payloadJson = JSON.stringify(ev.payload)
      insertEvent.run({
        id,
        messageId: assistantMsgId,
        runId,
        seq: eventSeq,
        kind: ev.kind,
        payload: payloadJson,
        createdAt,
      })
      publishRunLive(runId, {
        type: 'turn_event',
        id,
        messageId: assistantMsgId,
        runId,
        seq: eventSeq,
        kind: ev.kind,
        payload: ev.payload as TurnEventPayload,
        createdAt,
      })

      // Supervised control channel: arm an auto-deny timer when the agent asks
      // to use a tool, and close stdin once the turn is done so Claude exits.
      if (turn.keepStdinOpen) {
        if (ev.kind === 'approval_request' && ev.payload.requestId) {
          scheduleApprovalTimeout(ev.payload.requestId, ev.payload.name || 'tool')
        } else if (ev.kind === 'turn_done') {
          try {
            child.stdin?.end()
          } catch {
            // stdin already closed — nothing to do.
          }
        }
      }

      // A usage limit is terminal for this turn: the CLI has nothing left to
      // report and may simply idle until its window resets, so stop it now
      // with the reason in the log instead of a silent hour of `running`.
      if (ev.kind === 'error' && isUsageLimitMessage(ev.payload.message ?? '')) {
        noteTurn(`\n[executor] ${usageLimitStopMessage(ev.payload.message ?? '')}\n`)
        killChildTree(child, { graceMs: RUN_KILL_GRACE_MS })
      }

      if (ev.kind === 'turn_done' && !lingerTimer) {
        lingerTimer = setTimeout(() => {
          lingerTimer = null
          if (!isPidAlive(child.pid ?? 0)) return
          noteTurn('\n[executor] The agent reported the turn done but did not exit; stopping it.\n')
          killChildTree(child, { graceMs: RUN_KILL_GRACE_MS })
        }, TURN_DONE_LINGER_MS)
      }
    }
  }

  // Hoisted so persistEvents (defined above) can call them; both close over the
  // per-turn child, ids and DB statements.
  function scheduleApprovalTimeout(requestId: string, toolName: string) {
    if (approvalTimers.has(requestId)) return
    const timer = setTimeout(() => {
      resolveApproval(requestId, {
        decision: 'deny',
        reason: 'no response within timeout',
        message: 'Denied: approval timed out',
      })
    }, APPROVAL_TIMEOUT_MS)
    approvalTimers.set(requestId, timer)

    // Fan the prompt out app-wide, not just on this run's stream: the person
    // who needs to answer is often not looking at this run — or at this
    // machine. Both paths are best-effort; neither may disturb the run.
    const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS
    try {
      publishActivityLive({
        type: 'approval_pending',
        runId,
        requestId,
        toolName,
        expiresAt,
      })
    } catch {
      // A bad subscriber must not break the run.
    }
    // Read the label lazily — only when an approval actually fires, so the
    // hot path stays free of an extra query.
    let taskName = 'A run'
    try {
      const row = db.prepare('SELECT taskName FROM runs WHERE id = ?').get(runId) as
        | { taskName: string }
        | undefined
      if (row?.taskName) taskName = row.taskName
    } catch {
      // Fall back to the generic label.
    }
    void pushApprovalRequest({ runId, requestId, toolName, taskName, expiresAt }).catch(() => {})
  }

  function resolveApproval(requestId: string, answer: ApprovalAnswer): boolean {
    const timer = approvalTimers.get(requestId)
    if (!timer) return false // unknown / already resolved
    clearTimeout(timer)
    approvalTimers.delete(requestId)
    const { optionId, decision } = resolveApprovalAnswer({
      options: approvalOptions.get(requestId),
      optionId: answer.optionId,
      decision: answer.decision,
    })
    approvalOptions.delete(requestId)
    const reason = answer.reason
    try {
      // Claude's control protocol takes allow/deny, not an option id — the
      // option is what the transcript records, the decision is what it means.
      child.stdin?.write(
        buildControlResponse({ requestId, decision, message: answer.message ?? reason }),
      )
    } catch {
      // Child stdin gone — the run is ending; the event below still records it.
    }
    persistEvents([
      { kind: 'approval_resolved', payload: { requestId, optionId, decision, reason } },
    ])
    // Clear the prompt everywhere it was raised — including on a phone that is
    // showing a notification for an approval someone already answered.
    try {
      publishActivityLive({ type: 'approval_settled', runId, requestId, decision })
    } catch {
      // A bad subscriber must not break the run.
    }
    void pushApprovalSettled({ runId, requestId, decision }).catch(() => {})
    const note = `\n[executor] tool approval ${decision} (${requestId})${reason ? `: ${reason}` : ''}\n`
    appendRunStderr.run(note, runId)
    appendMsgStderr.run(note, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: note,
      messageId: assistantMsgId,
    })
    return true
  }

  function cleanupApprovals() {
    for (const timer of approvalTimers.values()) clearTimeout(timer)
    approvalTimers.clear()
    approvalOptions.clear()
    approvalsMap().delete(runId)
  }

  if (turn.keepStdinOpen) {
    approvalsMap().set(runId, {
      answer: (rid, answer) => resolveApproval(rid, answer),
      hasPending: () => approvalTimers.size > 0,
    })
  }

  const ingestStdoutChunk = (text: string) => {
    lastOutputAt = Date.now()
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled') return
    appendRunStdout.run(text, runId)
    appendMsgStdout.run(text, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stdout',
      chunk: text,
      messageId: assistantMsgId,
    })
    // Structured events only for CLIs that emit machine-readable JSONL.
    if (!structuredEvents) return
    const parsed: ParsedTurnEvent[] = []
    for (const line of lineBuffer.push(text)) {
      parsed.push(...(claudeIngest ? claudeIngest.pushLine(line) : parseTurnEventLine(line, kind)))
    }
    persistEvents(grokCoalescer ? grokCoalescer.push(parsed) : parsed)
  }

  child.stdout?.on('data', (d: Buffer) => {
    ingestStdoutChunk(d.toString())
  })
  child.stderr?.on('data', (d: Buffer) => {
    lastOutputAt = Date.now()
    const text = d.toString()
    appendRunStderr.run(text, runId)
    appendMsgStderr.run(text, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: text,
      messageId: assistantMsgId,
    })
  })

  child.on('error', (err) => {
    appendRunStderr.run(`\n[executor] process error: ${err.message}\n`, runId)
    appendMsgStderr.run(`\n[executor] process error: ${err.message}\n`, assistantMsgId)
    publishRunLive(runId, {
      type: 'log',
      stream: 'stderr',
      chunk: `\n[executor] process error: ${err.message}\n`,
      messageId: assistantMsgId,
    })
    if (structuredEvents) {
      persistEvents([
        { kind: 'error', payload: { message: err.message } },
        { kind: 'turn_done', payload: {} },
      ])
    }
    clearBudget()
    cleanupApprovals()
    liveMap().delete(runId)
    finalizeMessage(assistantMsgId, 'error', null, cwd)
    void concludeTurn({
      runId,
      assistantMessageId: assistantMsgId,
      status: 'error',
      exitCode: null,
      cwd,
      unattended,
    })
  })

  child.on('close', (code, signal) => {
    clearBudget()
    cleanupApprovals()
    liveMap().delete(runId)
    // Flush a trailing partial line so a dropped stream still yields an event.
    if (structuredEvents) {
      const rest = lineBuffer.flush()
      const parsed: ParsedTurnEvent[] = []
      if (rest.trim()) {
        parsed.push(
          ...(claudeIngest ? claudeIngest.pushLine(rest) : parseTurnEventLine(rest, kind)),
        )
      }
      if (grokCoalescer) {
        persistEvents(grokCoalescer.push(parsed))
        persistEvents(grokCoalescer.flush())
      } else if (claudeIngest) {
        persistEvents(parsed)
        persistEvents(claudeIngest.flush())
      } else if (parsed.length > 0) {
        persistEvents(parsed)
      }
    }
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled' || cancellationMap().has(runId)) {
      finalizeMessage(assistantMsgId, 'cancelled', code, cwd)
      publishRunStatus(runId, 'cancelled', code)
      publishActivityLive({ type: 'run_changed', runId, status: 'cancelled' })
      // The agent is gone for good now. Release the cancellation reservation,
      // quarantine unattended work, and only then hand a queued message or
      // another workspace run to a fresh process.
      completeCancelledRun(runId)
      return
    }
    if (signal) {
      const note = `\n[executor] terminated by signal ${signal}\n`
      appendRunStderr.run(note, runId)
      appendMsgStderr.run(note, assistantMsgId)
      publishRunLive(runId, {
        type: 'log',
        stream: 'stderr',
        chunk: note,
        messageId: assistantMsgId,
      })
    }
    let status: 'success' | 'error' = code === 0 ? 'success' : 'error'

    // Capture the session id from the first turn's output when the runtime
    // reports one (Codex), so follow-ups can resume it.
    const row = db
      .prepare('SELECT stdout, stderr FROM messages WHERE id = ?')
      .get(assistantMsgId) as { stdout: string; stderr: string } | undefined
    const existingSession = (
      db.prepare('SELECT sessionId FROM runs WHERE id = ?').get(runId) as { sessionId: string }
    ).sessionId
    if (!existingSession && row?.stdout) {
      const found = extractSessionId(row.stdout)
      if (found) db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(found, runId)
    }

    // A turn can exit 0 while an in-turn `gh`/`git` shipping step actually
    // failed (unauthenticated, no remote, missing binary). Surface that so an
    // agent-opened PR flow can't look green when no PR was created.
    if (status === 'success') {
      const combined = `${row?.stdout ?? ''}\n${row?.stderr ?? ''}`
      const gh = detectGhFailure(combined)
      if (gh.failed) {
        const note = `\n[executor] gh/git reported a failure but the turn exited 0: ${gh.reason}\n`
        appendRunStderr.run(note, runId)
        appendMsgStderr.run(note, assistantMsgId)
        publishRunLive(runId, {
          type: 'log',
          stream: 'stderr',
          chunk: note,
          messageId: assistantMsgId,
        })
        // Only runs that already have a structured transcript get this as an
        // event; on a plain-text run it would be the *only* event and would
        // hide the answer behind an otherwise-empty event list.
        if (structuredEvents) {
          persistEvents([{ kind: 'error', payload: { message: `gh/git: ${gh.reason}` } }])
        }
        status = 'error'
      }
    }

    finalizeMessage(assistantMsgId, status, code, cwd)

    if (promptFileDir) {
      try {
        rmSync(promptFileDir, { recursive: true, force: true })
      } catch {
        // ignore cleanup failure
      }
    }

    // The run stays `running` from here: verification executes in this same
    // worktree, and a repair turn may follow. concludeTurn owns the terminal
    // status from now on.
    void concludeTurn({
      runId,
      assistantMessageId: assistantMsgId,
      status,
      exitCode: code,
      cwd,
      unattended,
    })
  })

  publishRunLive(runId, {
    type: 'turn_started',
    userMessageId: userMsgId,
    assistantMessageId: assistantMsgId,
    prompt,
    createdAt: now,
  })

  if (turn.stdin !== null) {
    child.stdin?.write(turn.stdin)
  }
  // Supervised turns keep stdin open to answer approval control_responses; it
  // is closed on turn_done (see persistEvents) or when the run ends.
  if (!turn.keepStdinOpen) {
    child.stdin?.end()
  }

  return { userMessageId: userMsgId, assistantMessageId: assistantMsgId }
}

/**
 * Run one turn against an ACP agent.
 *
 * Same contract as the CLI path above — the message rows already exist, and
 * this fills in the assistant reply — but the agent is driven over JSON-RPC by
 * `acpTurn.ts` instead of having its stdout parsed. Everything downstream
 * (verification, repair, verdicts, cancellation) is shared: it all keys off the
 * same turn events, the same live map and the same `concludeTurn`.
 */
function spawnAcpTurn(input: {
  runId: string
  runtime: RuntimeRow
  cwd: string
  prompt: string
  sessionId: string
  args: string[]
  extraEnv?: Record<string, string>
  assistantMsgId: string
  timeoutMs: number
  unattended: boolean
}): void {
  const { runId, runtime, cwd, assistantMsgId, timeoutMs, unattended } = input
  const db = getDb()

  const appendRunStdout = db.prepare('UPDATE runs SET stdout = stdout || ? WHERE id = ?')
  const appendRunStderr = db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?')
  const appendMsgStdout = db.prepare('UPDATE messages SET stdout = stdout || ? WHERE id = ?')
  const appendMsgStderr = db.prepare('UPDATE messages SET stderr = stderr || ? WHERE id = ?')
  const insertEvent = db.prepare(
    `INSERT INTO turn_events (id, messageId, runId, seq, kind, payload, createdAt)
     VALUES (@id, @messageId, @runId, @seq, @kind, @payload, @createdAt)`,
  )

  let eventSeq = (
    db
      .prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM turn_events WHERE messageId = ?')
      .get(assistantMsgId) as { n: number }
  ).n
  const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const approvalOptions = new Map<string, PermissionOption[]>()
  const toolCallsById = new Map<
    string,
    {
      name?: string
      toolKind?: ToolKind
      callRole?: TurnEventPayload['callRole']
      mcpServer?: string
    }
  >()
  // Agent prose arrives as token-sized chunks over ACP; coalesce so chat gets
  // one paragraph per stretch instead of a row per token.
  const coalescer = new AssistantDeltaCoalescer()

  // Same three guards as the CLI path: an agent that goes silent says so in the
  // log, a usage limit ends the turn, and a finished agent may not linger.
  let lastOutputAt = Date.now()
  let stallNotes = 0
  let stallTimer: ReturnType<typeof setInterval> | null = null
  let lingerTimer: ReturnType<typeof setTimeout> | null = null

  const appendLog = (stream: 'stdout' | 'stderr', chunk: string) => {
    lastOutputAt = Date.now()
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled') return
    if (stream === 'stderr') {
      appendRunStderr.run(chunk, runId)
      appendMsgStderr.run(chunk, assistantMsgId)
    } else {
      appendRunStdout.run(chunk, runId)
      appendMsgStdout.run(chunk, assistantMsgId)
    }
    publishRunLive(runId, { type: 'log', stream, chunk, messageId: assistantMsgId })
  }

  const recordUsage = createTurnUsageSink(db, runId, assistantMsgId)

  const persistEvents = (events: ParsedTurnEvent[]) => {
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled') return
    for (const ev of events) {
      // A gauge, not a transcript row: fold it onto the message and move on.
      if (ev.kind === 'usage') {
        recordUsage(ev.payload.usage)
        continue
      }
      if (ev.kind === 'tool_start' && ev.payload.toolCallId) {
        toolCallsById.set(ev.payload.toolCallId, {
          name: ev.payload.name,
          toolKind: ev.payload.toolKind,
          callRole: ev.payload.callRole,
          mcpServer: ev.payload.mcpServer,
        })
      }
      if (ev.kind === 'tool_result' && ev.payload.toolCallId) {
        const opened = toolCallsById.get(ev.payload.toolCallId)
        if (opened) {
          if (!ev.payload.name) ev.payload.name = opened.name
          if (!ev.payload.toolKind) ev.payload.toolKind = opened.toolKind
          if (!ev.payload.callRole) ev.payload.callRole = opened.callRole
          if (!ev.payload.mcpServer) ev.payload.mcpServer = opened.mcpServer
        }
      }
      if (ev.kind === 'approval_request' && ev.payload.requestId) {
        approvalOptions.set(ev.payload.requestId, ev.payload.options ?? [])
        scheduleApprovalTimeout(ev.payload.requestId, ev.payload.name || 'tool')
      }

      eventSeq += 1
      const id = randomId('tev')
      const createdAt = Date.now()
      insertEvent.run({
        id,
        messageId: assistantMsgId,
        runId,
        seq: eventSeq,
        kind: ev.kind,
        payload: JSON.stringify(ev.payload),
        createdAt,
      })
      publishRunLive(runId, {
        type: 'turn_event',
        id,
        messageId: assistantMsgId,
        runId,
        seq: eventSeq,
        kind: ev.kind,
        payload: ev.payload as TurnEventPayload,
        createdAt,
      })

      if (ev.kind === 'error' && isUsageLimitMessage(ev.payload.message ?? '')) {
        appendLog('stderr', `\n[executor] ${usageLimitStopMessage(ev.payload.message ?? '')}\n`)
        stopAgent()
      }

      if (ev.kind === 'turn_done' && !lingerTimer) {
        lingerTimer = setTimeout(() => {
          lingerTimer = null
          if (settled || !isPidAlive(handle.child.pid ?? 0)) return
          appendLog(
            'stderr',
            '\n[executor] The agent reported the turn done but did not exit; stopping it.\n',
          )
          stopAgent()
        }, TURN_DONE_LINGER_MS)
      }
    }
  }

  /** End the agent now, whatever it is waiting for. */
  function stopAgent() {
    handle.cancelTurn()
    killChildTree(handle.child, { graceMs: RUN_KILL_GRACE_MS })
  }

  function scheduleApprovalTimeout(requestId: string, toolName: string) {
    if (approvalTimers.has(requestId)) return
    approvalTimers.set(
      requestId,
      setTimeout(() => {
        resolveApproval(requestId, {
          decision: 'deny',
          reason: 'no response within timeout',
        })
      }, APPROVAL_TIMEOUT_MS),
    )

    const expiresAt = Date.now() + APPROVAL_TIMEOUT_MS
    try {
      publishActivityLive({
        type: 'approval_pending',
        runId,
        requestId,
        toolName,
        expiresAt,
      })
    } catch {
      // A bad subscriber must not break the run.
    }
    let taskName = 'A run'
    try {
      const row = db.prepare('SELECT taskName FROM runs WHERE id = ?').get(runId) as
        | { taskName: string }
        | undefined
      if (row?.taskName) taskName = row.taskName
    } catch {
      // Fall back to the generic label.
    }
    void pushApprovalRequest({ runId, requestId, toolName, taskName, expiresAt }).catch(() => {})
  }

  function resolveApproval(requestId: string, answer: ApprovalAnswer): boolean {
    const timer = approvalTimers.get(requestId)
    if (!timer) return false
    clearTimeout(timer)
    approvalTimers.delete(requestId)
    const { optionId, decision } = resolveApprovalAnswer({
      options: approvalOptions.get(requestId),
      optionId: answer.optionId,
      decision: answer.decision,
    })
    approvalOptions.delete(requestId)
    // Over ACP the option id *is* the answer — no allow/deny translation.
    handle.answer(requestId, optionId)
    persistEvents([
      {
        kind: 'approval_resolved',
        payload: { requestId, optionId, decision, reason: answer.reason },
      },
    ])
    try {
      publishActivityLive({ type: 'approval_settled', runId, requestId, decision })
    } catch {
      // A bad subscriber must not break the run.
    }
    void pushApprovalSettled({ runId, requestId, decision }).catch(() => {})
    appendLog(
      'stderr',
      `\n[acp] tool approval ${decision} (${requestId})${answer.reason ? `: ${answer.reason}` : ''}\n`,
    )
    return true
  }

  let budgetTimer: ReturnType<typeof setTimeout> | null = null
  let settled = false

  const handle = startAcpTurn(
    {
      bin: runtime.bin,
      args: input.args,
      cwd,
      prompt: input.prompt,
      sessionId: input.sessionId,
      // Only the protocol-scoped list: whatever the agent reads from its own
      // config file it has already loaded by the time the session opens.
      mcpServers: protocolMcpServers({ bin: runtime.bin, transport: runtime.transport, cwd }),
      extraEnv: turnEnv(runId, input.extraEnv),
    },
    {
      onEvents: (events) => persistEvents(coalescer.push(events)),
      onLog: appendLog,
      onSessionId: (sessionId) => {
        db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId)
      },
      onDone: ({ code, error }) => {
        if (settled) return
        settled = true
        if (budgetTimer) clearTimeout(budgetTimer)
        budgetTimer = null
        if (stallTimer) clearInterval(stallTimer)
        stallTimer = null
        if (lingerTimer) clearTimeout(lingerTimer)
        lingerTimer = null
        persistEvents(coalescer.flush())
        for (const timer of approvalTimers.values()) clearTimeout(timer)
        approvalTimers.clear()
        approvalsMap().delete(runId)
        liveMap().delete(runId)
        if (error) appendLog('stderr', `\n[acp] ${error}\n`)

        const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
          | { status: string }
          | undefined
        if (current?.status === 'cancelled' || cancellationMap().has(runId)) {
          finalizeMessage(assistantMsgId, 'cancelled', code, cwd)
          publishRunStatus(runId, 'cancelled', code)
          publishActivityLive({ type: 'run_changed', runId, status: 'cancelled' })
          completeCancelledRun(runId)
          return
        }

        const status: 'success' | 'error' = code === 0 ? 'success' : 'error'
        finalizeMessage(assistantMsgId, status, code, cwd)
        void concludeTurn({
          runId,
          assistantMessageId: assistantMsgId,
          status,
          exitCode: code,
          cwd,
          unattended,
        })
      },
    },
  )

  liveMap().set(runId, { child: handle.child, requestStop: () => handle.cancelTurn() })
  db.prepare('UPDATE runs SET pid = ? WHERE id = ?').run(handle.child.pid ?? null, runId)
  approvalsMap().set(runId, {
    answer: (rid, answer) => resolveApproval(rid, answer),
    hasPending: () => approvalTimers.size > 0,
  })

  stallTimer = setInterval(() => {
    const silentMs = Date.now() - lastOutputAt
    const due = Math.floor(silentMs / RUN_STALL_AFTER_MS)
    if (due <= stallNotes) return
    stallNotes = due
    const quietSince = lastOutputAt
    appendLog('stderr', `\n[executor] ${runStalledMessage(silentMs)}\n`)
    // Our own note is not the agent speaking, so it must not restart the clock.
    lastOutputAt = quietSince
  }, RUN_STALL_CHECK_MS)

  budgetTimer = setTimeout(() => {
    budgetTimer = null
    const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
      | { status: string }
      | undefined
    if (current?.status === 'cancelled' || cancellationMap().has(runId)) return
    appendLog('stderr', `\n[executor] ${runTimedOutMessage(timeoutMs)}\n`)
    db.prepare('UPDATE runs SET timedOut = 1 WHERE id = ?').run(runId)
    handle.cancelTurn()
    killChildTree(handle.child, { graceMs: RUN_KILL_GRACE_MS })
  }, timeoutMs)
}

/**
 * Close out an assistant message: prefer structured events for the readable
 * reply, fall back to scraping stdout, and snapshot the working tree so the
 * Files Changed panel has data.
 */
function finalizeMessage(
  messageId: string,
  status: 'success' | 'error' | 'cancelled',
  exitCode: number | null,
  cwd: string,
) {
  const db = getDb()
  const row = db
    .prepare('SELECT stdout, stderr, runId FROM messages WHERE id = ?')
    .get(messageId) as { stdout: string; stderr: string; runId: string } | undefined

  const events = listTurnEventsForMessage(messageId)
  const fromEvents = assistantTextFromEvents(events)
  const content =
    fromEvents || parseAssistantText(row?.stdout ?? '') || meaningfulStderr(row?.stderr).trim()

  const run = row?.runId
    ? (db.prepare('SELECT baseSnapshot FROM runs WHERE id = ?').get(row.runId) as
        | { baseSnapshot: string }
        | undefined)
    : undefined
  const since = run?.baseSnapshot || undefined

  let diff: ReturnType<typeof changedFiles> = []
  try {
    diff = changedFiles(cwd, since)
  } catch {
    // A missing or non-git cwd just means no diff panel for this turn.
  }

  const finishedAt = Date.now()
  db.prepare(
    'UPDATE messages SET status = ?, exitCode = ?, content = ?, diffSummary = ?, finishedAt = ? WHERE id = ?',
  ).run(status, exitCode, content, JSON.stringify(diff), finishedAt, messageId)

  // The run stays `running` through verification and any repair turn, so the
  // transcript would keep spinning on an answer that is already final if it
  // had to wait for the run-level `status` frame.
  if (row?.runId) {
    publishRunLive(row.runId, {
      type: 'turn_finished',
      messageId,
      status,
      exitCode,
      content,
      diffSummary: diff,
      finishedAt,
    })
  }
}

function finalizeRun(
  runId: string,
  status: 'success' | 'error',
  code: number | null,
  verdict: RunVerdict,
) {
  getDb()
    .prepare('UPDATE runs SET status = ?, exitCode = ?, verdict = ?, finishedAt = ? WHERE id = ?')
    .run(status, code, verdict, Date.now(), runId)
  publishRunStatus(runId, status, code)
  publishActivityLive({ type: 'run_changed', runId, status, verdict })
  // A queued follow-up means the conversation is not over: it takes the
  // workspace straight back, so neither the "run finished" notification nor
  // the workspace queue should treat this as the end.
  if (drainMessageQueue(runId)) return
  onRunFinalized(runId)
}

/**
 * Start the oldest follow-up parked for this run, if the run is free. Returns
 * true when a turn was started.
 *
 * The entry is only removed once the turn is under way — a refusal (workspace
 * taken, binary gone, session no longer resumable) leaves the message queued
 * so the user can retry or discard it rather than watching it vanish.
 */
export function drainMessageQueue(runId: string): boolean {
  // SIGINT/SIGTERM: a cancelled run must not spawn a replacement agent while
  // the process is exiting.
  if (isShuttingDown()) return false
  const entry = peekQueuedMessage(runId)
  if (!entry) return false
  const run = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
    | { status: string }
    | undefined
  if (!run || run.status === 'running') return false

  try {
    sendFollowUp({
      runId,
      prompt: entry.prompt,
      ...(entry.runtimeId ? { runtimeId: entry.runtimeId } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      ...(entry.effort ? { effort: entry.effort } : {}),
      ...(entry.runtimeMode ? { runtimeMode: entry.runtimeMode } : {}),
    })
  } catch (err) {
    console.error(`[messages] could not start queued follow-up for run ${runId}:`, err)
    return false
  }
  removeQueuedMessage(entry.id)
  return true
}

/**
 * Hook invoked once a run reaches a terminal status. Assigned by `core.ts` so
 * the executor can notify and drain the queue without importing either — both
 * of those need to read tasks/projects, which would be a cycle back through
 * this module.
 */
type RunFinalizedHook = (runId: string) => void
let runFinalizedHook: RunFinalizedHook | null = null

export function setRunFinalizedHook(hook: RunFinalizedHook | null): void {
  runFinalizedHook = hook
}

function onRunFinalized(runId: string) {
  if (!runFinalizedHook) return
  try {
    runFinalizedHook(runId)
  } catch (err) {
    console.error(`[executor] run-finalized hook failed for ${runId}:`, err)
  }
}

/**
 * Finish cancellation only after no child, verification pass, or follow-up
 * can still write to the workspace. The in-memory cancellation marker is set
 * up front so the child stops normal conclusion work; the database stays
 * `running` until this function confirms the process and checks are gone.
 */
function completeCancelledRun(runId: string): void {
  const pending = cancellationMap().get(runId)
  if (!pending) return
  if (liveMap().has(runId) || verifyingMap().has(runId)) return
  const row = getDb().prepare('SELECT pid FROM runs WHERE id = ?').get(runId) as
    | { pid: number | null }
    | undefined
  if (isPidAlive(row?.pid)) return

  // Keep the row running while a cancellation is in flight. This prevents a
  // terminal status from being mistaken for a free workspace by any caller.
  // The reservation is still useful for the verification-only/no-pid case and
  // survives HMR on globalThis.
  getDb()
    .prepare("UPDATE runs SET status = 'cancelled', verdict = '', finishedAt = ? WHERE id = ?")
    .run(Date.now(), runId)
  getDb()
    .prepare(
      "UPDATE messages SET status = 'cancelled', finishedAt = ? WHERE runId = ? AND status = 'running'",
    )
    .run(Date.now(), runId)
  publishRunStatus(runId, 'cancelled', null)
  publishActivityLive({ type: 'run_changed', runId, status: 'cancelled' })

  cancellationMap().delete(runId)
  drainOnExitSet().delete(runId)
  if (pending.trigger === 'schedule' || pending.trigger === 'webhook') {
    recordRunOutcomeForWorkspace({
      workspaceId: pending.workspaceId,
      taskName: pending.taskName || 'an unattended run',
      verdict: 'cancelled',
    })
  }
  releaseWorkspaceCancellation(pending.workspaceId)

  // A queued follow-up belongs to this conversation and gets first chance to
  // resume it. If there is no follow-up, notify the normal workspace queue now
  // that the child is definitely gone.
  if (pending.drainQueue && drainMessageQueue(runId)) return
  onRunFinalized(runId)
}

function waitForCancelledRun(runId: string): void {
  const check = () => {
    if (!cancellationMap().has(runId)) return
    if (
      liveMap().has(runId) ||
      verifyingMap().has(runId) ||
      isPidAlive(
        (
          getDb().prepare('SELECT pid FROM runs WHERE id = ?').get(runId) as
            | { pid: number | null }
            | undefined
        )?.pid,
      )
    ) {
      const timer = setTimeout(check, 50)
      timer.unref?.()
      return
    }
    completeCancelledRun(runId)
  }
  check()
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

type VerificationSettings = {
  /** 0 disables the repair loop for this run. */
  maxRepairAttempts: number
  /** False when the task opted out of post-run checks. */
  verifyEnabled: boolean
  timeoutMs: number
}

const NO_VERIFICATION: VerificationSettings = {
  maxRepairAttempts: 0,
  verifyEnabled: false,
  timeoutMs: 0,
}

/**
 * Per-run verification settings, read from the automation that owns the run.
 * A run with no task row (chat, planner) is a conversation someone is sitting
 * in, and gets neither checks nor repair turns.
 */
function verificationSettings(taskId: string | null): VerificationSettings {
  if (!taskId) return NO_VERIFICATION
  const row = getDb()
    .prepare('SELECT verifyEnabled, maxRepairAttempts, timeoutMs FROM tasks WHERE id = ?')
    .get(taskId) as
    | { verifyEnabled: number; maxRepairAttempts: number; timeoutMs: number }
    | undefined
  if (!row) return NO_VERIFICATION
  return {
    maxRepairAttempts: row.maxRepairAttempts ?? 0,
    verifyEnabled: row.verifyEnabled !== 0,
    timeoutMs: row.timeoutMs ?? 0,
  }
}

/**
 * Atomically acquire the in-memory verification reservation and confirm that
 * cancellation has not won the race. JavaScript runs this registration and
 * both durable/in-memory reads without yielding, so `cancelRun` can never
 * release a workspace between the last check and the check runner starting.
 *
 * `afterRegister` is a deterministic test seam for exercising the exact
 * cancellation window; production callers omit it.
 */
export function acquireVerificationController(
  runId: string,
  afterRegister?: () => void,
): AbortController | null {
  const controller = new AbortController()
  const active = verifyingMap()
  active.set(runId, controller)
  try {
    afterRegister?.()
  } catch (err) {
    if (active.get(runId) === controller) active.delete(runId)
    throw err
  }

  const row = getDb().prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
    | { status: string }
    | undefined
  const cancelled = row?.status === 'cancelled' || cancellationMap().has(runId)
  if (cancelled) {
    controller.abort()
    if (active.get(runId) === controller) active.delete(runId)
    return null
  }
  return controller
}

function countChangedFiles(cwd: string, baseSnapshot: string): number {
  try {
    return changedFiles(cwd, baseSnapshot || undefined).length
  } catch {
    // A missing or non-git cwd means we cannot tell — treat it as "something
    // may have changed" so a run is never labelled `no-changes` on a guess.
    return 1
  }
}

function failureSummaries(results: CheckResultRow[]): FailedCheckSummary[] {
  return results
    .filter((r) => r.outcome === 'failed' || r.outcome === 'timeout')
    .map((r) => ({
      name: r.name,
      command: r.command,
      outcome: r.outcome as CheckOutcome,
      exitCode: r.exitCode,
      output: r.output,
    }))
}

/**
 * Decide what a finished turn actually amounted to: run the project's checks,
 * derive the verdict, and either hand the failures back to the agent for one
 * more go or close the run out.
 *
 * The run deliberately stays `running` for the whole of this — checks execute
 * in the run's worktree, so releasing the workspace lock first would let a
 * scheduled run start editing files out from under `pnpm test`. That is also
 * why `unattended` turns are the only ones verified: holding a conversation
 * hostage to a test suite after every message you type is a cost with no
 * matching benefit, since you are right there to judge the result yourself.
 */
async function concludeTurn(input: {
  runId: string
  assistantMessageId: string
  status: 'success' | 'error'
  exitCode: number | null
  cwd: string
  /** False for a human-typed turn: no checks, no repair, no waiting. */
  unattended: boolean
}): Promise<void> {
  const db = getDb()
  const run = db
    .prepare(
      'SELECT id, taskId, runtimeId, workspaceId, baseSnapshot, repairAttempts, timedOut, status FROM runs WHERE id = ?',
    )
    .get(input.runId) as
    | {
        id: string
        taskId: string | null
        runtimeId: string
        workspaceId: string
        baseSnapshot: string
        repairAttempts: number
        timedOut: number
        status: string
      }
    | undefined
  if (!run) return

  const timedOut = run.timedOut === 1
  const settings = input.unattended ? verificationSettings(run.taskId) : NO_VERIFICATION
  const cancellationRequested = run.status === 'cancelled' || cancellationMap().has(input.runId)

  let results: CheckResultRow[] = []
  // Only a clean turn is worth verifying — a crashed or over-budget agent has
  // already told us the answer, and running the test suite anyway just delays
  // the failure the user is waiting on.
  if (input.status === 'success' && !timedOut && settings.verifyEnabled && !cancellationRequested) {
    const defs = checksForWorkspace(run.workspaceId)
    if (defs.length > 0) {
      const controller = acquireVerificationController(input.runId)
      if (controller) {
        try {
          const pass = await runCheckPass({
            runId: input.runId,
            messageId: input.assistantMessageId,
            attempt: run.repairAttempts,
            cwd: input.cwd,
            checks: defs,
            signal: controller.signal,
          })
          results = pass.results
        } catch (err) {
          console.error(`[executor] verification failed for ${input.runId}:`, err)
        } finally {
          if (verifyingMap().get(input.runId) === controller) {
            verifyingMap().delete(input.runId)
          }
        }
      }
    }
  }

  // Cancelled while the checks were running — the user's decision wins. The
  // cancellation completion path marks the row terminal after this pass has
  // unwound and the workspace is safe to reuse.
  const current = db.prepare('SELECT status FROM runs WHERE id = ?').get(input.runId) as
    | { status: string }
    | undefined
  if (current?.status === 'cancelled' || cancellationMap().has(input.runId)) return

  const verdict = deriveVerdict({
    status: input.status,
    timedOut,
    checks: results.map((r) => ({ outcome: r.outcome as CheckOutcome })),
    changedFiles: countChangedFiles(input.cwd, run.baseSnapshot),
  })

  publishRunLive(input.runId, {
    type: 'verdict',
    verdict,
    repairAttempts: run.repairAttempts,
  })

  const runtime = db.prepare('SELECT * FROM runtimes WHERE id = ?').get(run.runtimeId) as
    | RuntimeRow
    | undefined

  if (
    runtime &&
    shouldAttemptRepair({
      verdict,
      attemptsUsed: run.repairAttempts,
      maxAttempts: settings.maxRepairAttempts,
      canFollowUp: supportsResume(runtime.bin, runtime.transport),
    })
  ) {
    const attempt = run.repairAttempts + 1
    db.prepare('UPDATE runs SET repairAttempts = ? WHERE id = ?').run(attempt, input.runId)
    publishRunLive(input.runId, {
      type: 'repair_started',
      attempt,
      maxAttempts: settings.maxRepairAttempts,
    })
    try {
      sendFollowUp({
        runId: input.runId,
        prompt: buildRepairPrompt(failureSummaries(results), attempt),
        timeoutMs: settings.timeoutMs,
        internal: true,
      })
      // The repair turn concludes through its own close handler.
      return
    } catch (err) {
      // Session gone, binary vanished mid-run, runtime cannot resume after
      // all — record it and close out on the failed-checks verdict rather
      // than leaving the run stuck as `running`.
      const note = `\n[executor] could not start repair turn: ${String(err)}\n`
      db.prepare('UPDATE runs SET stderr = stderr || ? WHERE id = ?').run(note, input.runId)
      publishRunLive(input.runId, {
        type: 'log',
        stream: 'stderr',
        chunk: note,
        messageId: input.assistantMessageId,
      })
    }
  }

  // An unattended run owns its workspace's fitness for the next unattended
  // run: a bad verdict quarantines it so the following automation refuses the
  // worktree instead of inheriting the broken tree it left behind, and a good
  // one lifts an earlier quarantine. Attended turns are excluded — a human is
  // looking at the result and does not need the workspace taken away.
  if (input.unattended) {
    const taskName = db.prepare('SELECT taskName FROM runs WHERE id = ?').get(input.runId) as
      | { taskName: string }
      | undefined
    recordRunOutcomeForWorkspace({
      workspaceId: run.workspaceId,
      taskName: taskName?.taskName ?? 'a scheduled run',
      verdict,
    })
  }

  finalizeRun(input.runId, input.status, input.exitCode, verdict)
}

/** Latest verification results for a run, newest pass only. */
export { latestCheckResults, listCheckResults } from './checks'

/**
 * Run the project's checks against a finished run on demand.
 *
 * Checks are otherwise only recorded after an unattended turn, so a
 * conversation the user is sitting in can show a red panel from hours ago
 * while the working tree has moved on — and the agent, asked to "fix the
 * failing checks", sees nothing wrong. This is how the panel is brought back
 * in line with the tree without spending a turn.
 *
 * The pass replaces any previous pass for the same turn: it is a re-run of
 * that judgement, not an extra one.
 */
export async function runChecksNow(runId: string): Promise<CheckResultRow[]> {
  const db = getDb()
  const run = db
    .prepare(
      'SELECT id, status, cwd, workspaceId, baseSnapshot, repairAttempts FROM runs WHERE id = ?',
    )
    .get(runId) as
    | {
        id: string
        status: string
        cwd: string
        workspaceId: string
        baseSnapshot: string
        repairAttempts: number
      }
    | undefined
  if (!run) throw new Error('Run not found')
  if (run.status === 'running') throw new Error('This run is still working — wait for it to finish')
  if (verifyingMap().has(runId)) throw new Error('Checks are already running for this run')

  const defs = checksForWorkspace(run.workspaceId)
  if (defs.length === 0) throw new Error('This project has no verification checks configured')

  // Checks execute in the run's worktree; another run must not be mid-edit.
  if (run.workspaceId.trim().length > 0) assertWorkspaceFree(run.workspaceId)

  const last = db
    .prepare(
      "SELECT id FROM messages WHERE runId = ? AND role = 'assistant' ORDER BY createdAt DESC LIMIT 1",
    )
    .get(runId) as { id: string } | undefined
  const messageId = last?.id ?? ''

  clearCheckPass(runId, messageId, run.repairAttempts)

  const controller = new AbortController()
  verifyingMap().set(runId, controller)
  let results: CheckResultRow[] = []
  try {
    const pass = await runCheckPass({
      runId,
      messageId,
      attempt: run.repairAttempts,
      cwd: run.cwd,
      checks: defs,
      signal: controller.signal,
    })
    results = pass.results
  } finally {
    verifyingMap().delete(runId)
  }

  // The verdict is a statement about the checks, so re-running them restates
  // it. No repair turn: this path is explicitly the user asking, not the
  // unattended loop.
  const verdict = deriveVerdict({
    status: 'success',
    timedOut: false,
    checks: results.map((r) => ({ outcome: r.outcome as CheckOutcome })),
    changedFiles: countChangedFiles(run.cwd, run.baseSnapshot),
  })
  db.prepare('UPDATE runs SET verdict = ? WHERE id = ?').run(verdict, runId)
  publishRunLive(runId, { type: 'verdict', verdict, repairAttempts: run.repairAttempts })
  publishActivityLive({ type: 'run_changed', runId, status: run.status, verdict })

  return results
}

export function listMessages(runId: string): MessageRow[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE runId = ? ORDER BY createdAt ASC')
    .all(runId) as MessageRow[]
}

export function listTurnEventsForMessage(messageId: string): TurnEventRow[] {
  return getDb()
    .prepare('SELECT * FROM turn_events WHERE messageId = ? ORDER BY seq ASC')
    .all(messageId) as TurnEventRow[]
}

export function listTurnEventsForRun(runId: string): TurnEventRow[] {
  return getDb()
    .prepare('SELECT * FROM turn_events WHERE runId = ? ORDER BY messageId, seq ASC')
    .all(runId) as TurnEventRow[]
}

/**
 * Cancel a run and kill its CLI (and process group). Falls back to the stored
 * pid when the in-memory handle is missing (server restart / HMR), so Cancel
 * never becomes a DB-only flip that leaves a token-burning orphan.
 */
export function cancelRun(runId: string, opts?: { drainQueue?: boolean }): boolean {
  const live = liveMap().get(runId)
  const db = getDb()
  // "Send now": the turn is being interrupted so a queued message can take
  // over, which is the opposite of a Stop — no finished notification, and the
  // workspace stays reserved for this conversation.
  const drainQueue = opts?.drainQueue === true
  const row = db
    .prepare('SELECT pid, workspaceId, trigger, taskName, status FROM runs WHERE id = ?')
    .get(runId) as
    | { pid: number | null; workspaceId: string; trigger: string; taskName: string; status: string }
    | undefined
  if (row?.status !== 'running') return false

  if (drainQueue) drainOnExitSet().add(runId)
  else drainOnExitSet().delete(runId)
  cancellationMap().set(runId, {
    workspaceId: row.workspaceId,
    trigger: row.trigger,
    taskName: row.taskName,
    drainQueue,
  })
  if (row.workspaceId.trim()) reserveWorkspaceCancellation(row.workspaceId)

  // A run in verification has no live agent child but is very much still
  // occupying the worktree — cancel has to reach the checks too.
  const verification = verifyingMap().get(runId)
  if (verification) {
    verification.abort()
  }

  live?.requestStop?.()

  let killed = false
  const child = childOf(live)
  if (child) {
    // Leave the handle in liveMap until the close handler removes it. Dropping
    // it here used to make killChildTree's stillLive() skip SIGKILL while the
    // CLI ignored SIGTERM and kept spending tokens.
    killChildTree(child, { graceMs: RUN_KILL_GRACE_MS })
    killed = true
  } else if (row?.pid != null && isPidAlive(row.pid)) {
    // No handle (restart/HMR) but the OS process is still there — kill by pid.
    killed = killPidTree(row.pid)
  }

  // A live child is completed by its close handler. For a restart/HMR case,
  // poll the stored pid; for verification-only cancellation, poll until the
  // aborted check has unwound. In both cases the reservation remains held.
  waitForCancelledRun(runId)

  return killed || Boolean(verification)
}

/** Cancel every running run for a task (used when the automation is disabled). */
export function cancelRunsForTask(taskId: string): number {
  const rows = getDb()
    .prepare("SELECT id FROM runs WHERE taskId = ? AND status = 'running'")
    .all(taskId) as Array<{ id: string }>
  for (const row of rows) cancelRun(row.id)
  return rows.length
}

type OrphanRow = {
  id: string
  pid: number | null
  workspaceId: string
  trigger: string
  taskName: string
}

function markOrphanTerminal(row: OrphanRow, now: number, note: string): void {
  const db = getDb()
  db.prepare(
    "UPDATE runs SET status = 'error', verdict = 'crashed', finishedAt = ?, stderr = stderr || ? WHERE id = ? AND status = 'running'",
  ).run(now, note, row.id)
  db.prepare(
    "UPDATE messages SET status = 'error', finishedAt = ? WHERE runId = ? AND status = 'running'",
  ).run(now, row.id)
  publishRunStatus(row.id, 'error', null)
  publishActivityLive({ type: 'run_changed', runId: row.id, status: 'error' })
  onRunFinalized(row.id)
}

/** Keep an orphaned workspace reserved until its stored pid is truly gone. */
function releaseOrphanReservationAfterExit(
  workspaceId: string,
  pid: number,
  onExit: () => void,
): void {
  const check = () => {
    if (isPidAlive(pid)) {
      const timer = setTimeout(check, 50)
      timer.unref?.()
      return
    }
    releaseWorkspaceCancellation(workspaceId)
    onExit()
    // Reconciliation runs before the normal queue boot drain. Kick this one
    // workspace when the delayed kill finally finishes instead of waiting for
    // the next scheduler tick.
    void import('./runQueue.ts').then(({ drainWorkspace }) => drainWorkspace(workspaceId))
  }
  check()
}

/**
 * On boot: any row still `running` has no live handle in this process. Kill
 * leftover OS processes by stored pid, quarantine unattended workspaces, and
 * only mark rows terminal once the process is gone. Without this, a crash
 * leaves phantom rows or lets a surviving CLI write beside a replacement.
 */
export function reconcileOrphanRuns(): { marked: number; killed: number } {
  const db = getDb()
  const orphans = db
    .prepare("SELECT id, pid, workspaceId, trigger, taskName FROM runs WHERE status = 'running'")
    .all() as OrphanRow[]

  let killed = 0
  const now = Date.now()
  const note =
    '\n[executor] Server restarted while this run was in flight — process reaped and run marked crashed.\n'

  for (const row of orphans) {
    // Prefer the live handle if HMR reloaded modules but the process is still
    // tracked — cancelRun covers that path completely.
    if (liveMap().has(row.id)) {
      cancelRun(row.id)
      killed += 1
      continue
    }

    const pidLive = row.pid != null && isPidAlive(row.pid)
    if (pidLive && row.workspaceId.trim()) reserveWorkspaceCancellation(row.workspaceId)
    if (pidLive && row.pid != null && killPidTree(row.pid)) killed += 1

    if (row.trigger === 'schedule' || row.trigger === 'webhook') {
      // A restarted server cannot know whether the child was about to commit,
      // edit, or run checks. Treat the tree as contaminated until an explicit
      // restore (or a later verified run) clears the quarantine.
      recordRunOutcomeForWorkspace({
        workspaceId: row.workspaceId,
        taskName: row.taskName || 'an unattended run',
        verdict: 'crashed',
      })
    }

    if (pidLive && row.pid != null) {
      releaseOrphanReservationAfterExit(row.workspaceId, row.pid, () =>
        markOrphanTerminal(row, Date.now(), note),
      )
    } else if (row.workspaceId.trim()) {
      releaseWorkspaceCancellation(row.workspaceId)
      markOrphanTerminal(row, now, note)
    } else {
      markOrphanTerminal(row, now, note)
    }
  }

  if (orphans.length > 0) {
    console.warn(
      `[executor] reconciled ${orphans.length} orphan running run(s) on boot (${killed} process(es) signalled)`,
    )
  }
  return { marked: orphans.length, killed }
}

/** Cancel every in-flight run — used on process shutdown. */
export function cancelAllLiveRuns(): number {
  const ids = new Set<string>([
    ...liveMap().keys(),
    ...(
      getDb().prepare("SELECT id FROM runs WHERE status = 'running'").all() as Array<{ id: string }>
    ).map((r) => r.id),
  ])
  for (const id of ids) cancelRun(id)
  return ids.size
}

/**
 * Install once: on SIGINT/SIGTERM, stop every agent CLI before the process
 * exits so a Ctrl+C of the dev server does not leave grok/claude burning tokens.
 */
export function installProcessShutdownHooks(): void {
  if (g.__agentopsShutdownHooks) return
  g.__agentopsShutdownHooks = true

  const shutdown = (signal: string) => {
    // Block cron / queue drain from starting a replacement agent while we kill.
    setShuttingDown(true)
    const n = cancelAllLiveRuns()
    if (n > 0) {
      console.warn(`[executor] ${signal}: cancelled ${n} live run(s) before exit`)
    }
    // Give SIGTERM a brief window to land, then force-exit so we do not hang
    // the shell waiting on a wedged child.
    setTimeout(() => process.exit(0), RUN_KILL_GRACE_MS + 250).unref?.()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

/** Convenience: run a task by its row (used by the scheduler and "run now"). */
export function runTask(
  task: TaskRow,
  runtime: RuntimeRow,
  trigger: 'manual' | 'schedule' | 'webhook',
  promptOverride?: string,
  source?: MessageSource,
) {
  // Task-backed runs must never hit the process.cwd() fallback — that path is
  // reserved for planner (intentional) and other non-task callers.
  assertWorkspaceId(task.workspaceId)
  return startRun({
    runtime,
    taskId: task.id,
    taskName: task.name,
    prompt: promptOverride ?? task.prompt,
    cwd: task.cwd,
    workspaceId: task.workspaceId,
    trigger,
    // Use the model/effort the task was saved with; empty falls back to the
    // CLI default inside buildTurnCommand.
    model: task.model,
    effort: task.effort,
    timeoutMs: task.timeoutMs,
    resumeSessionId: task.resumeSessionId,
    resumeSessionLabel: task.resumeSessionLabel,
    ...(source ? { source } : {}),
  })
}
