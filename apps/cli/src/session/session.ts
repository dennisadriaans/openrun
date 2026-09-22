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
export type PendingRequest = { id: string; text: string; detail: string }
export type OverviewRow = { id: string; prompt: string; when: string }
export type HomeOverview = {
  scheduled?: number
  automations?: number
  runs?: number
  running?: number
  integrations?: number
  tasks?: OverviewRow[]
  activeRuns?: OverviewRow[]
  error?: string
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
  private saveWarningShown = false

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

  enqueue(text: string): void {
    if (!text.trim()) return
    this.pending.push({ id: randomUUID(), text: text.trim(), detail: 'Queued' })
    this.log('user', text)
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
      // Requests redirected from a form have already left that form's flow.
      this.current = { id: randomUUID(), text, detail: 'Preparing request' }
      this.responded = false
      this.log('user', text)
    }
    this.changed()
  }

  progress(detail: string): void {
    if (this.current) this.current.detail = detail
    this.changed()
  }

  finish(message?: string): void {
    if (!this.current) return
    if (message || !this.responded) this.log('assistant', message || 'Completed.')
    this.current = undefined
    this.changed()
  }

  updateOverview(overview: HomeOverview): void {
    // Failed reads leave successful sections on screen until they can refresh.
    this.overview = { ...this.overview, ...overview }
    this.changed()
  }

  runChanged(id: string, status: string): void {
    if (this.runStates.get(id) === status) return
    this.runStates.set(id, status)
    const name = this.overview.activeRuns?.find((run) => run.id === id)?.prompt || id
    this.log('system', `Run ${name} · ${status}`)
  }
}
