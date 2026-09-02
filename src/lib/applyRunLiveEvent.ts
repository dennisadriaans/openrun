/**
 * Patch a cached conversation from a live-run SSE frame.
 *
 * Returns the next cache value, or signals a full refetch (terminal status, or
 * a turn_event whose message is not cached yet).
 */
import type { QueuedMessage } from './messageQueue'
import type { CheckResultFrame, RunLiveEvent } from './runLive'
import type { TurnEventRow } from './turnEvents'

/**
 * A check as the conversation cache holds it. `outcome: 'running'` is the
 * client-only placeholder written on `check_started` and replaced when the
 * matching `check_finished` frame arrives.
 */
export type CachedCheckResult = Omit<CheckResultFrame, 'finishedAt'> & {
  finishedAt: number | null
}

/** Minimal conversation shape — matches `getConversation` fields we touch. */
export type ConversationCacheSlice = {
  run: {
    id: string
    status: string
    stdout: string
    stderr: string
    exitCode: number | null
    verdict?: string
  }
  /** Verification results for the run; absent on caches that predate checks. */
  checkResults?: CachedCheckResult[]
  messages: Array<{
    id: string
    runId?: string
    role?: string
    content?: string
    stdout: string
    stderr: string
    status: string
    exitCode: number | null
    events: TurnEventRow[]
    diffSummary?: unknown[]
    createdAt?: number
    finishedAt?: number | null
  }>
  canFollowUp?: boolean
  /** Follow-ups waiting on the current turn; absent on caches that predate them. */
  queued?: QueuedMessage[]
}

export type ApplyRunLiveResult<T> =
  | { action: 'ignore' }
  | { action: 'refetch' }
  | { action: 'patch'; data: T }

export function applyRunLiveEvent<T extends ConversationCacheSlice>(
  data: T,
  event: RunLiveEvent,
): ApplyRunLiveResult<T> {
  switch (event.type) {
    case 'ping':
    case 'hello':
      return { action: 'ignore' }
    case 'status': {
      const running = event.status === 'running'
      return {
        action: 'patch',
        data: {
          ...data,
          run: { ...data.run, status: event.status, exitCode: event.exitCode },
          canFollowUp: running ? false : (event.canFollowUp ?? data.canFollowUp),
        },
      }
    }
    case 'turn_finished':
      return patchTurnFinished(data, event)
    case 'turn_started':
      return patchTurnStarted(data, event)
    case 'log':
      if (data.run.status === 'cancelled') return { action: 'ignore' }
      return { action: 'patch', data: patchLog(data, event) }
    case 'turn_event':
      if (data.run.status === 'cancelled') return { action: 'ignore' }
      return patchTurnEvent(data, event)
    case 'check_started':
      return patchCheckStarted(data, event)
    case 'check_finished':
      return patchCheckFinished(data, event)
    case 'verdict':
      return {
        action: 'patch',
        data: { ...data, run: { ...data.run, verdict: event.verdict } },
      }
    case 'repair_started':
      // The repair turn's own `turn_started` frame carries the cache update.
      return { action: 'ignore' }
    case 'queue_changed':
      return { action: 'patch', data: { ...data, queued: event.queued } }
    default: {
      // Unknown frame shape — do not guess; let polling/refetch converge.
      const _exhaustive: never = event
      void _exhaustive
      return { action: 'refetch' }
    }
  }
}

function patchCheckStarted<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'check_started' }>,
): ApplyRunLiveResult<T> {
  const existing = data.checkResults ?? []
  if (existing.some((c) => c.id === event.id)) return { action: 'ignore' }
  const placeholder: CachedCheckResult = {
    id: event.id,
    runId: event.runId,
    messageId: event.messageId,
    attempt: event.attempt,
    checkId: event.checkId,
    name: event.name,
    command: event.command,
    outcome: 'running',
    exitCode: null,
    output: '',
    durationMs: 0,
    startedAt: event.startedAt,
    finishedAt: null,
  }
  // A re-run repeats a pass the cache already holds: the server dropped the
  // old rows, so the same check re-appearing in the same turn/attempt replaces
  // its predecessor rather than doubling the pass.
  const superseded = existing.filter(
    (c) =>
      !(
        c.checkId === event.checkId &&
        c.messageId === event.messageId &&
        c.attempt === event.attempt
      ),
  )
  return { action: 'patch', data: { ...data, checkResults: [...superseded, placeholder] } }
}

function patchCheckFinished<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'check_finished' }>,
): ApplyRunLiveResult<T> {
  const existing = data.checkResults ?? []
  const idx = existing.findIndex((c) => c.id === event.result.id)
  const next = existing.slice()
  if (idx >= 0) next[idx] = event.result
  else next.push(event.result)
  return { action: 'patch', data: { ...data, checkResults: next } }
}

function patchTurnStarted<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'turn_started' }>,
): ApplyRunLiveResult<T> {
  if (data.messages.some((m) => m.id === event.assistantMessageId)) {
    return { action: 'ignore' }
  }

  const runId = data.run.id
  const userCreatedAt = event.createdAt
  const assistantCreatedAt = event.createdAt + 1

  const userStub = {
    id: event.userMessageId,
    runId,
    role: 'user',
    content: event.prompt,
    stdout: '',
    stderr: '',
    status: 'success',
    exitCode: null,
    events: [] as TurnEventRow[],
    diffSummary: [],
    sourceProvider: '',
    sourceUrl: '',
    sourceLabel: '',
    createdAt: userCreatedAt,
    finishedAt: userCreatedAt,
  }
  const assistantStub = {
    id: event.assistantMessageId,
    runId,
    role: 'assistant',
    content: '',
    stdout: '',
    stderr: '',
    status: 'running',
    exitCode: null,
    events: [] as TurnEventRow[],
    diffSummary: [],
    sourceProvider: '',
    sourceUrl: '',
    sourceLabel: '',
    createdAt: assistantCreatedAt,
    finishedAt: null,
  }

  const next = {
    ...data,
    run: { ...data.run, status: 'running' as const, exitCode: null },
    messages: [...data.messages, userStub, assistantStub],
    ...(data.canFollowUp !== undefined ? { canFollowUp: false } : {}),
  }
  return { action: 'patch', data: next as T }
}

function patchTurnFinished<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'turn_finished' }>,
): ApplyRunLiveResult<T> {
  const idx = data.messages.findIndex((m) => m.id === event.messageId)
  if (idx < 0) return { action: 'refetch' }
  const message = data.messages[idx]!
  if (message.status !== 'running') return { action: 'ignore' }
  const messages = data.messages.slice()
  messages[idx] = {
    ...message,
    status: event.status,
    exitCode: event.exitCode,
    // A turn that produced no prose keeps whatever the stream already showed.
    content: event.content || message.content,
    diffSummary: event.diffSummary,
    finishedAt: event.finishedAt,
  }
  return { action: 'patch', data: { ...data, messages } }
}

function patchLog<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'log' }>,
): T {
  const field = event.stream === 'stderr' ? 'stderr' : 'stdout'
  const run = { ...data.run, [field]: data.run[field] + event.chunk }
  const messages = data.messages.map((m) =>
    m.id === event.messageId ? { ...m, [field]: m[field] + event.chunk } : m,
  )
  return { ...data, run, messages }
}

function patchTurnEvent<T extends ConversationCacheSlice>(
  data: T,
  event: Extract<RunLiveEvent, { type: 'turn_event' }>,
): ApplyRunLiveResult<T> {
  const idx = data.messages.findIndex((m) => m.id === event.messageId)
  if (idx < 0) {
    // Message not in cache yet (turn_started patch / mutation seed still in flight).
    return { action: 'refetch' }
  }
  const message = data.messages[idx]!
  if (message.events.some((e) => e.id === event.id)) {
    return { action: 'ignore' }
  }
  const row: TurnEventRow = {
    id: event.id,
    messageId: event.messageId,
    runId: event.runId,
    seq: event.seq,
    kind: event.kind,
    payload: JSON.stringify(event.payload ?? {}),
    createdAt: event.createdAt,
  }
  const events = [...message.events, row]
  const messages = data.messages.slice()
  messages[idx] = { ...message, events }
  return { action: 'patch', data: { ...data, messages } }
}

/** Patch a bare run row cache (`['run', id]`) when present. */
export function applyRunLiveEventToRunRow<
  T extends { id: string; status: string; stdout: string; stderr: string; exitCode: number | null },
>(run: T, event: RunLiveEvent): ApplyRunLiveResult<T> {
  switch (event.type) {
    case 'ping':
    case 'hello':
      return { action: 'ignore' }
    case 'status':
      return {
        action: 'patch',
        data: { ...run, status: event.status, exitCode: event.exitCode },
      }
    case 'turn_started':
      return {
        action: 'patch',
        data: { ...run, status: 'running', exitCode: null },
      }
    case 'turn_event':
    case 'turn_finished':
    case 'check_started':
    case 'check_finished':
    case 'repair_started':
    case 'queue_changed':
      // The bare run row carries no per-message state — the conversation cache does.
      return { action: 'ignore' }
    case 'verdict':
      return { action: 'patch', data: { ...run, verdict: event.verdict } }
    case 'log': {
      const field = event.stream === 'stderr' ? 'stderr' : 'stdout'
      return { action: 'patch', data: { ...run, [field]: run[field] + event.chunk } }
    }
    default: {
      const _exhaustive: never = event
      void _exhaustive
      return { action: 'refetch' }
    }
  }
}
