import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { openrunHome } from '@openrun/runtime/paths'

export type TimelineEntry = {
  id: string
  at: number
  role: 'user' | 'assistant' | 'system'
  text: string
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
  readonly file: string | null
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

  constructor(file: string | null = join(openrunHome(), 'cli-sessions', `${randomUUID()}.jsonl`)) {
    this.file = file
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  log(role: TimelineEntry['role'], message: string): void {
    const text = transcriptText(message).trim()
    if (!text) return
    const entry = { id: randomUUID(), at: Date.now(), role, text }
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
