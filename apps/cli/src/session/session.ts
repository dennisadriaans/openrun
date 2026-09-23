import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { openrunHome } from '@openrun/runtime/paths'
import { cardText } from '../terminal/layout.ts'

/** What a request started, shown under its prompt; the status follows Activity. */
export type StatusCard = {
  status: string
  title: string
  /** Clock time on the right: when a schedule fires, or when a run started. */
  time?: string
  /** A one-off schedule's fire time, so "in 10 seconds" stays current. */
  at?: number
  /** How a recurring schedule repeats, e.g. "every day". */
  repeats?: string
  model?: string
  effort?: string
  taskId?: string
  runId?: string
}
export type TimelineEntry = {
  id: string
  at: number
  role: 'user' | 'assistant' | 'system'
  text: string
  card?: StatusCard
}
export type PendingRequest = {
  id: string
  at: number
  text: string
  detail: string
  /** Opened from the interface (a click), not typed: it leaves no chat trail. */
  silent?: boolean
}
/** What a finished run left in its workspace, fetched once per run. */
export type RunChanges = { files: number; additions: number; deletions: number }
export type OverviewRow = {
  id: string
  prompt: string
  when: string
  time?: string
  model?: string
  effort?: string
  taskId?: string | null
  startedAt?: number
}
export type ActivityItem = {
  prompt: string
  status: string
  time?: string
  nextTime?: string
  model?: string
  effort?: string
  runId?: string
  startedAt?: number
  changes?: RunChanges
}
export type HomeOverview = {
  scheduled?: number
  automations?: number
  runs?: number
  running?: number
  integrations?: number
  tasks?: OverviewRow[]
  activeRuns?: OverviewRow[]
  recentRuns?: OverviewRow[]
  error?: string
}

/** A transcript from an earlier CLI session, offered by /resume. */
export type SavedSession = {
  file: string
  title: string
  startedAt: number
  updatedAt: number
  /** Requests typed in that session, excluding slash commands. */
  requests: number
}

const SESSION_LIMIT = 50

export function sessionsDirectory(): string {
  return join(openrunHome(), 'cli-sessions')
}

function newSessionFile(directory: string): string {
  return join(directory, `${randomUUID()}.jsonl`)
}

/** Slash commands manage the session itself; they never name one. */
export function isSlashCommand(text: string): boolean {
  return /^\/[a-z][\w-]*$/i.test(text.trim())
}

function savedEntry(line: string): TimelineEntry | undefined {
  try {
    const value: unknown = JSON.parse(line)
    if (!value || typeof value !== 'object') return undefined
    const entry = value as Partial<TimelineEntry>
    if (
      typeof entry.id !== 'string' ||
      typeof entry.at !== 'number' ||
      !['user', 'assistant', 'system'].includes(String(entry.role)) ||
      typeof entry.text !== 'string'
    )
      return undefined
    const card = entry.card && typeof entry.card === 'object' ? entry.card : undefined
    return {
      id: entry.id,
      at: entry.at,
      role: entry.role as TimelineEntry['role'],
      text: entry.text,
      ...(card && typeof card.status === 'string' && typeof card.title === 'string' && { card }),
    }
  } catch {
    return undefined
  }
}

/** Read one transcript, skipping lines a crash or an older CLI left unreadable. */
export function readSessionFile(file: string): TimelineEntry[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const entry = line.trim() && savedEntry(line)
      return entry ? [entry] : []
    })
}

/** Earlier sessions, most recent first. Sessions without a typed request are skipped. */
export function savedSessions(directory = sessionsDirectory(), exclude?: string | null): SavedSession[] {
  let files: { file: string; modified: number }[]
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(directory, name))
      .filter((file) => !exclude || basename(file) !== basename(exclude))
      .flatMap((file) => {
        try {
          return [{ file, modified: statSync(file).mtimeMs }]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
  const sessions: SavedSession[] = []
  for (const { file } of files.sort((a, b) => b.modified - a.modified)) {
    if (sessions.length >= SESSION_LIMIT) break
    let entries: TimelineEntry[]
    try {
      entries = readSessionFile(file)
    } catch {
      continue
    }
    const requests = entries.filter((entry) => entry.role === 'user' && !isSlashCommand(entry.text))
    if (!requests.length) continue
    sessions.push({
      file,
      title: requests[0]!.text.split('\n')[0]!.trim(),
      startedAt: entries[0]!.at,
      updatedAt: entries.at(-1)!.at,
      requests: requests.length,
    })
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function runStatusLabel(status: string): string {
  if (status === 'error') return 'Failed'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** Labels of runs that will not change their workspace any further. */
export function runFinished(label: string): boolean {
  return /^(?:success|succeeded|completed|failed|cancelled|canceled)$/i.test(label)
}

/** Command transcripts must not introduce another plaintext credential store. */
export function transcriptText(text: string): string {
  return stripVTControlCharacters(text)
    .replace(
      /(--(?:token|access-token|password|secret|api-key)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1[hidden]',
    )
    .replace(
      /("(?:token|accessToken|password|secret|apiKey)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[hidden]"',
    )
}

/** Survives renderer handoffs. Queued requests are consumed exactly once, in order. */
export class CliSession {
  readonly entries: TimelineEntry[] = []
  readonly pending: PendingRequest[] = []
  file: string | null
  /** Bumped when the timeline is replaced rather than appended to. */
  generation = 0
  overview: HomeOverview = {}
  draft = ''
  current?: PendingRequest
  private listeners = new Set<() => void>()
  private responded = false
  private selected?: PendingRequest
  private runStates = new Map<string, string>()
  private activityItems = new Map<string, ActivityItem>()
  private openedAt = Date.now()
  private saveWarningShown = false
  private changesRequested = new Set<string>()

  constructor(file: string | null = newSessionFile(sessionsDirectory())) {
    this.file = file
  }

  /** Start over in a new transcript. The request that asked for it stays in flight. */
  reset(): void {
    this.file = this.file && newSessionFile(dirname(this.file))
    this.replace([])
  }

  /** Continue an earlier transcript: show it, and append new entries to the same file. */
  resume(file: string): void {
    const entries = readSessionFile(file)
    this.file = file
    this.replace(entries)
  }

  private replace(entries: TimelineEntry[]): void {
    this.entries.splice(0, this.entries.length, ...entries)
    this.activityItems.clear()
    this.runStates.clear()
    this.changesRequested.clear()
    this.openedAt = Date.now()
    this.saveWarningShown = false
    // Runs the earlier session started return to Activity once the worker reports them.
    for (const { card } of entries) if (card?.runId) this.runStates.set(card.runId, card.status)
    // The request that replaced the timeline must not add "Completed." to the new one.
    this.responded = true
    this.generation++
    this.changed()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  log(role: TimelineEntry['role'], message: string, card?: StatusCard): void {
    const text = transcriptText(message).trim()
    if (!text) return
    const entry: TimelineEntry = {
      id: randomUUID(),
      at: Date.now(),
      role,
      text,
      ...(card && { card }),
    }
    this.entries.push(entry)
    if (role === 'assistant' && this.current) this.responded = true
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
        appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
      } catch {
        if (!this.saveWarningShown) {
          this.saveWarningShown = true
          this.entries.push({
            id: randomUUID(),
            at: Date.now(),
            role: 'system',
            text: 'Could not save the session transcript. This timeline remains available until you exit.',
          })
        }
      }
    }
    this.changed()
  }

  card(card: StatusCard): void {
    this.log('assistant', cardText(card), card)
  }

  enqueue(text: string, silent = false): void {
    if (!text.trim()) return
    this.pending.push({
      id: randomUUID(),
      at: Date.now(),
      text: text.trim(),
      detail: 'Queued',
      ...(silent ? { silent } : {}),
    })
    if (!silent) this.log('user', text)
    else this.changed()
  }

  take(): string | undefined {
    this.selected = this.pending.shift()
    return this.selected?.text
  }

  begin(text?: string): void {
    if (this.selected && this.selected.text === text) {
      this.current = this.selected
      this.selected = undefined
      this.current.detail = 'Preparing request'
      this.responded = false
    } else if (!this.current && text) {
      // A click that unwound a form was queued silently; adopt it instead of echoing it.
      const queued = this.pending.findIndex((request) => request.silent && request.text === text)
      if (queued >= 0) {
        this.current = this.pending.splice(queued, 1)[0]!
        this.current.detail = 'Preparing request'
      } else {
        // Requests redirected from a form have already left that form's flow.
        this.current = { id: randomUUID(), at: Date.now(), text, detail: 'Preparing request' }
        this.log('user', text)
      }
      this.responded = false
    }
    this.changed()
  }

  progress(detail: string): void {
    if (this.current) this.current.detail = detail
    this.changed()
  }

  finish(message?: string): void {
    if (!this.current) return
    if (message || (!this.responded && !this.current.silent))
      this.log('assistant', message || 'Completed.')
    this.current = undefined
    this.changed()
  }

  updateOverview(overview: HomeOverview): void {
    // Failed reads leave successful sections on screen until they can refresh.
    this.overview = { ...this.overview, ...overview }
    const tasks = new Map((this.overview.tasks ?? []).map((task) => [`task:${task.id}`, task]))
    for (const [key, task] of tasks) {
      const existing = this.activityItems.get(key)
      this.activityItems.set(
        key,
        existing?.runId
          ? { ...existing, nextTime: task.when }
          : {
              prompt: task.prompt,
              status: 'Scheduled',
              time: task.when,
              model: task.model,
              effort: task.effort,
            },
      )
    }
    // Recent results fill in names for fast runs that finish between refreshes.
    // Only work seen during this session belongs in its activity list.
    const recent = (overview.recentRuns ?? []).filter(
      (run) => this.runStates.has(run.id) || (run.startedAt ?? 0) >= this.openedAt,
    )
    for (const run of [...recent].reverse().concat(overview.activeRuns ?? [])) {
      const previousKey = [...this.activityItems].find(([, item]) => item.runId === run.id)?.[0]
      const key = run.taskId ? `task:${run.taskId}` : (previousKey ?? `run:${run.id}`)
      const existing = this.activityItems.get(key)
      if (run.when === 'Queued') {
        if (existing?.status === 'Running') continue
      } else if (existing?.runId !== run.id && (existing?.startedAt ?? 0) > (run.startedAt ?? 0)) {
        continue
      }
      const task = tasks.get(key)
      this.activityItems.set(key, {
        prompt: task?.prompt ?? existing?.prompt ?? run.prompt,
        status: run.when,
        time: run.time ?? existing?.time,
        nextTime: task?.when,
        model: run.model ?? existing?.model ?? task?.model,
        effort: run.effort ?? existing?.effort ?? task?.effort,
        runId: run.id,
        startedAt: run.startedAt,
        ...(existing?.runId === run.id && existing.changes ? { changes: existing.changes } : {}),
      })
      if (previousKey && previousKey !== key) this.activityItems.delete(previousKey)
      this.runStates.set(run.id, run.when)
    }
    const activeIds = overview.activeRuns && new Set(overview.activeRuns.map((run) => run.id))
    for (const [key, item] of this.activityItems) {
      if (item.status === 'Queued' && item.runId && activeIds && !activeIds.has(item.runId)) {
        const task = tasks.get(key)
        if (task)
          this.activityItems.set(key, {
            prompt: task.prompt,
            status: 'Scheduled',
            time: task.when,
            model: task.model,
            effort: task.effort,
          })
        else this.activityItems.delete(key)
      } else if (!tasks.has(key)) {
        if (!item.runId) this.activityItems.delete(key)
        else item.nextTime = undefined
      }
    }
    this.changed()
  }

  get activity(): ActivityItem[] {
    return [...this.activityItems.values()]
  }

  /** The Activity item a chat card stands for, once the worker has reported it. */
  activityFor(card: Pick<StatusCard, 'taskId' | 'runId'>): ActivityItem | undefined {
    if (card.taskId) {
      const task = this.activityItems.get(`task:${card.taskId}`)
      if (task) return task
    }
    return card.runId ? this.activity.find((item) => item.runId === card.runId) : undefined
  }

  /** Finished runs whose changes have not been asked for yet; each is returned once. */
  takeRunsAwaitingChanges(): string[] {
    const ids = this.activity
      .filter((item) => item.runId && runFinished(item.status) && !item.changes)
      .map((item) => item.runId!)
      .filter((id) => !this.changesRequested.has(id))
    for (const id of ids) this.changesRequested.add(id)
    return ids
  }

  runChanges(id: string, changes: RunChanges): void {
    const item = this.activity.find((run) => run.runId === id)
    if (!item) return
    item.changes = changes
    this.changed()
  }

  runChanged(id: string, status: string): void {
    const label = runStatusLabel(status)
    if (this.runStates.get(id) === label) return
    this.runStates.set(id, label)
    const item = this.activity.find((run) => run.runId === id)
    if (item) item.status = label
    this.changed()
  }
}
