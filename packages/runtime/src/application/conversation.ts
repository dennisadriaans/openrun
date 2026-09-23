/** conversation capability implementation. */
import {
  getRunEnvironment,
  releasedResult,
  releaseRunEnvironment,
} from '../execution/runEnvironment.ts'
import { parseVerdict } from '@openrun/domain/runs/verdict'
import {
  defaultEffort,
  defaultModel,
  findModel,
  type ModelOption,
} from '@openrun/domain/runtimes/models'
import { cachedModelsForBin } from '../runtimes/modelCatalog.ts'
import { parseRuntimeMode } from '@openrun/domain/runtimes/runtimeMode'
import { slimConversationEvent } from '@openrun/domain/chat/turnEvents'
import { parseTransport } from '@openrun/domain/runtimes/acpTransport'
import { getDb, type MessageRow, type RunRow } from '../storage/db.ts'
import {
  answerApproval as _answerApproval,
  listMessages,
  listTurnEventsForRun,
  sendFollowUp,
} from '../execution/executor.ts'
import { listCheckResults } from '../execution/checks.ts'
import { enqueueMessage, listQueuedMessages } from '../execution/messageQueue.ts'
import type { ApprovalDecision } from '@openrun/domain/chat/claudeControl'

import * as git from '../workspaces/git.ts'
import {
  isPullRequestLive,
  type FailingCheck,
  type PullRequestChecks,
  type PullRequestState,
  type RunPullRequest,
} from '@openrun/domain/workspaces/pullRequest'
import { supportsResume } from '../execution/resume.ts'
import type { TurnEventRow } from '@openrun/domain/chat/turnEvents'
import { assistantTextFromEvents } from '../execution/turnEvents.ts'
import { getProject, getWorkspace, listWorkspaces } from '../workspaces/workspaces.ts'
import { getRun, flushQueuedFollowUps } from './runs.ts'
import { getRuntime } from './runtimes.ts'

export type ChatMessage = Omit<MessageRow, 'diffSummary'> & {
  diffSummary: git.DiffFile[]
  /** Structured turn events for this message (empty for legacy / generic runs). */
  events: TurnEventRow[]
}

/**
 * Chat-focused conversation payload (no git/`gh` work). Right panel data lives
 * in `getRunWorkspace` so polling the live chat does not re-shell git.
 */
export function getConversation(runId: string) {
  const run = getRun(runId)
  if (!run) return null

  const runtime = getRuntime(run.runtimeId)
  const stored = listMessages(runId)
  const eventsByMessage = new Map<string, TurnEventRow[]>()
  for (const ev of listTurnEventsForRun(runId)) {
    const list = eventsByMessage.get(ev.messageId) ?? []
    list.push(slimConversationEvent(ev))
    eventsByMessage.set(ev.messageId, list)
  }
  const messages: ChatMessage[] =
    stored.length > 0
      ? stored.map((m) => {
          const events = eventsByMessage.get(m.id) ?? []
          const fromEvents =
            m.role === 'assistant' && events.length > 0 ? assistantTextFromEvents(events) : ''
          // Prefer events for chat text; omit duplicating fat per-message logs
          // when structured events already carry the turn.
          const hasEvents = events.length > 0
          return {
            ...m,
            content: fromEvents || m.content,
            stdout: hasEvents ? '' : m.stdout,
            stderr: hasEvents ? '' : m.stderr,
            diffSummary: parseDiffSummary(m.diffSummary),
            events,
          }
        })
      : synthesizeLegacyMessages(run)

  const workspace = run.workspaceId ? getWorkspace(run.workspaceId) : undefined
  const siblings = workspace ? listWorkspaces(workspace.projectId) : []
  const workspaceWithMeta = workspace ? (siblings.find((w) => w.id === workspace.id) ?? null) : null
  const project = workspace ? (getProject(workspace.projectId) ?? null) : null

  const catalog = runtime ? cachedModelsForBin(runtime.bin) : []
  const matchedModel = findModel(catalog, run.model)
  const selectedModel = matchedModel ?? defaultModel(catalog)

  const siblingWorkspaces = siblings.filter((w) => w.status !== 'archived')

  const resumable =
    !!runtime &&
    supportsResume(runtime.bin, runtime.transport) &&
    (run.sessionId.length > 0 || runtimeSupportsLastResume(runtime.bin))

  return {
    run,
    execution: getRunEnvironment(runId) ?? null,
    messages,
    checkResults: listCheckResults(runId),
    /** Follow-ups typed while this run was working, oldest first. */
    queued: listQueuedMessages(runId),
    verdict: parseVerdict(run.verdict),
    canFollowUp: resumable && run.status !== 'running',
    /**
     * Whether a follow-up may be *typed* — the same test minus the busy check,
     * because a message sent at a working agent is queued rather than refused.
     */
    canQueueFollowUp: resumable,
    /**
     * A handoff starts a fresh session, so it needs nothing from the current
     * runtime — a run that cannot resume can still be continued elsewhere.
     */
    canSwitchRuntime: run.status !== 'running',
    workspace: workspaceWithMeta,
    project,
    workspaces: siblingWorkspaces,
    runtime: runtime
      ? {
          id: runtime.id,
          label: runtime.label,
          bin: runtime.bin,
          transport: parseTransport(runtime.transport),
        }
      : null,
    models: catalog as ModelOption[],
    model: selectedModel?.slug || '',
    effort: matchedModel
      ? run.effort || defaultEffort(selectedModel)
      : defaultEffort(selectedModel),
    runtimeMode: parseRuntimeMode(run.runtimeMode),
  }
}

/**
 * Pull request attached to a run, cached on the run row.
 *
 * The probe shells out to `gh`, so it is rate-limited per run rather than run
 * on every workspace poll. A merged or closed PR stops moving, so it is only
 * re-probed on the slow interval; a live one refreshes often enough to catch a
 * merge shortly after it happens.
 */
const PR_LIVE_TTL_MS = 30_000

const PR_SETTLED_TTL_MS = 10 * 60_000

function cachedRunPullRequest(run: RunRow): RunPullRequest | null {
  if (!run.prNumber || !run.prUrl) return null
  const states: PullRequestState[] = ['open', 'draft', 'merged', 'closed']
  const checks: PullRequestChecks[] = ['passing', 'failing', 'pending', 'none']
  if (!states.includes(run.prState as PullRequestState)) return null
  if (!checks.includes(run.prChecks as PullRequestChecks)) return null
  return {
    number: run.prNumber,
    url: run.prUrl,
    title: run.prTitle,
    state: run.prState as PullRequestState,
    checks: run.prChecks as PullRequestChecks,
    failingChecks: parseFailingChecks(run.prFailingChecks),
  }
}

/** Tolerant read of the cached failing-check list; '' on older rows. */
function parseFailingChecks(raw: string | null | undefined): FailingCheck[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const row = entry as Record<string, unknown>
      if (typeof row.name !== 'string') return []
      return [{ name: row.name, url: typeof row.url === 'string' ? row.url : '' }]
    })
  } catch {
    return []
  }
}

function persistRunPullRequest(runId: string, pr: RunPullRequest | null) {
  getDb()
    .prepare(
      `UPDATE runs SET prNumber = @prNumber, prUrl = @prUrl, prTitle = @prTitle,
       prState = @prState, prChecks = @prChecks, prFailingChecks = @prFailingChecks,
       prCheckedAt = @prCheckedAt WHERE id = @id`,
    )
    .run({
      id: runId,
      prNumber: pr?.number ?? 0,
      prUrl: pr?.url ?? '',
      prTitle: pr?.title ?? '',
      prState: pr?.state ?? '',
      prChecks: pr?.checks ?? '',
      prFailingChecks: JSON.stringify(pr?.failingChecks ?? []),
      prCheckedAt: Date.now(),
    })
}

export async function getRunPullRequest(runId: string): Promise<RunPullRequest | null> {
  const run = getRun(runId)
  if (!run) return null

  const cached = cachedRunPullRequest(run)
  const ttl = cached && !isPullRequestLive(cached.state) ? PR_SETTLED_TTL_MS : PR_LIVE_TTL_MS
  if (run.prCheckedAt && Date.now() - run.prCheckedAt < ttl) return cached

  // `headBranch` is captured before the finalization hook can release the
  // workspace to another run. Rows from before that column existed retain the
  // starting branch, which is a safe identity; never inspect today's mutable
  // checkout for a completed legacy run.
  const branch = run.headBranch.trim() || run.baseBranch.trim()
  const fresh = await git.pullRequestForBranchAsync(
    getRunEnvironment(runId)?.repoPath ?? run.cwd,
    branch,
  )
  if (fresh.kind === 'error') {
    // Keep a previously good cache intact. Throwing lets React Query expose the
    // probe failure while retaining stale data during a refetch.
    throw new Error(fresh.reason)
  }
  // Only an authoritative empty list clears the cache. A successful PR result
  // replaces it, including state transitions such as open → merged.
  persistRunPullRequest(runId, fresh.kind === 'found' ? fresh.pullRequest : null)
  if (fresh.kind === 'found' && fresh.pullRequest.state === 'merged') releaseRunEnvironment(runId)
  return fresh.kind === 'found' ? fresh.pullRequest : null
}

/** Drop the TTL so the next read re-probes — used after opening a PR. */
export function invalidateRunPullRequest(runId: string) {
  getDb().prepare('UPDATE runs SET prCheckedAt = 0 WHERE id = ?').run(runId)
}

/** Files / repo / gh for the run detail right panel — deferred from chat load. */
export async function getRunWorkspace(runId: string) {
  const run = getRun(runId)
  if (!run) return null

  const saved = releasedResult(runId)
  const [files, repo, gh, commits] = await Promise.all([
    saved ? saved.files : git.changedFilesAsync(run.cwd, run.baseSnapshot || undefined),
    saved ? saved.repo : git.repoInfoAsync(run.cwd),
    git.ghStatusAsync(),
    saved ? saved.commits : git.runCommitsAsync(run.cwd, run.baseSnapshot || ''),
  ])
  // Derive dirty from the same file list — avoid a second changedFiles pass.
  if (run.baseSnapshot) {
    repo.dirty = files.length > 0
  }

  return {
    runId,
    files,
    repo,
    totals: {
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    },
    gh,
    commits,
    taskName: run.taskName,
    baseBranch: run.baseBranch,
  }
}

/**
 * Runs recorded before conversations existed have stdout/stderr on the run row
 * but no message rows. Present them as a single assistant turn so the chat view
 * still shows their output instead of an empty transcript.
 */
function synthesizeLegacyMessages(run: RunRow): ChatMessage[] {
  if (!run.stdout && !run.stderr) return []
  return [
    {
      id: `${run.id}_legacy`,
      runId: run.id,
      role: 'assistant',
      content: run.stdout.trim() || run.stderr.trim(),
      stdout: run.stdout,
      stderr: run.stderr,
      status: run.status,
      exitCode: run.exitCode,
      diffSummary: [],
      sourceProvider: '',
      sourceUrl: '',
      sourceLabel: '',
      createdAt: run.startedAt,
      finishedAt: run.finishedAt,
      events: [],
    },
  ]
}

/** Codex can resume its most recent session without an explicit id. */
function runtimeSupportsLastResume(bin: string) {
  return (bin.split(/[\\/]/).pop() ?? bin).includes('codex')
}

function parseDiffSummary(raw: string): git.DiffFile[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as git.DiffFile[]) : []
  } catch {
    return []
  }
}

/**
 * Answer a pending tool-approval on a supervised (Claude) run. Writes the
 * allow/deny decision to the live child's stdin control channel. Returns false
 * when there is no matching pending request (already resolved or timed out).
 */
export function answerApproval(input: {
  runId: string
  requestId: string
  /** ACP option id the user picked; falls back to a plain allow/deny. */
  optionId?: string
  decision?: ApprovalDecision
  message?: string
}): { answered: boolean } {
  return { answered: _answerApproval(input) }
}

/** Hard cap on follow-up prompt size to avoid accidental stdin/DB bloat. */
const MAX_MESSAGE_PROMPT_CHARS = 100_000

export type PostMessageResult =
  | { queued: false; userMessageId: string; assistantMessageId: string }
  | { queued: true; id: string; position: number }

/**
 * Send a follow-up, or park it when the agent is mid-turn.
 *
 * Every CLI we drive lets you keep typing while it works, so refusing here was
 * the odd one out. A message that lands on a busy run joins the run's queue and
 * becomes its own turn when the current one ends; `force` says don't wait —
 * interrupt the agent and start the queue now.
 */
export function postMessage(input: {
  runId: string
  prompt: string
  /** Hand the conversation to a different runtime on this turn. */
  runtimeId?: string
  model?: string
  effort?: string
  runtimeMode?: string
  userMessageId?: string
  assistantMessageId?: string
  /** Interrupt the running turn instead of waiting for it. */
  force?: boolean
}): PostMessageResult {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Message cannot be empty')
  if (prompt.length > MAX_MESSAGE_PROMPT_CHARS) {
    throw new Error(
      `Message is too long (max ${MAX_MESSAGE_PROMPT_CHARS.toLocaleString()} characters)`,
    )
  }

  const run = getRun(input.runId)
  if (!run) throw new Error('Run not found')

  // A queue that outlived a stopped turn keeps its order: a new message goes
  // behind it, not in front, however the run got free.
  if (run.status === 'running' || listQueuedMessages(input.runId).length > 0) {
    const parked = enqueueMessage({
      runId: input.runId,
      prompt,
      model: input.model,
      effort: input.effort,
      runtimeMode: input.runtimeMode,
      runtimeId: input.runtimeId,
    })
    if (!parked.queued) throw new Error(parked.reason)
    if (input.force) flushQueuedFollowUps(input.runId)
    return { queued: true, id: parked.id, position: parked.position }
  }

  return {
    queued: false,
    ...sendFollowUp({
      runId: input.runId,
      prompt,
      runtimeId: input.runtimeId,
      model: input.model,
      effort: input.effort,
      runtimeMode: input.runtimeMode,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
    }),
  }
}
