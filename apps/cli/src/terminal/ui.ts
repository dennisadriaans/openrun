import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalSurface } from './terminal.ts'
import { openrunHome } from '@openrun/runtime/paths'
import { CommandHistory } from '../session/history.ts'
import { isImplicitRequest } from '../commands/natural.ts'
import {
  CliSession,
  savedSessions,
  sessionsDirectory,
  type HomeOverview,
  type OverviewRow,
  type RunChanges,
  type SavedSession,
  type StatusCard,
} from '../session/session.ts'
import { cardText } from './layout.ts'
import type { ReviewAction, ReviewView } from './review.ts'

export type Choice = { value: string; label: string; hint?: string }
export type ScheduledTaskView = OverviewRow
const HOME_CHOICES: Choice[] = [
  { value: 'launch', label: 'Open a coding agent' },
  { value: 'run', label: 'Run a task' },
  { value: 'schedule', label: 'Schedule an automation' },
  { value: 'runs', label: 'Recent runs' },
  { value: 'review', label: 'Review changes' },
  { value: 'continue', label: 'Continue a run' },
  { value: 'ls', label: 'Manage automations' },
  { value: 'init', label: 'Set up a project' },
  { value: 'integrations', label: 'Manage integrations' },
  { value: 'projects', label: 'Projects' },
  { value: 'runtimes', label: 'Agents and models' },
  { value: 'worker', label: 'Background worker' },
  { value: 'api', label: 'Application operations' },
  { value: 'resume', label: 'Resume a CLI session' },
  { value: 'clear', label: 'Clear the conversation' },
  { value: 'help', label: 'Help' },
  { value: 'refresh', label: 'Refresh overview' },
  { value: 'exit', label: 'Quit' },
]
const HOME_ALIASES: [RegExp, string][] = [
  [/^(?:show|list|view|see)(?: me)? (?:recent |active )?runs?$/i, 'runs'],
  [/^(?:show|view|see|inspect)(?: me)?(?: the| my)? (?:changes|diffs?|edits)$/i, 'review'],
  [/^(?:show|list|manage|view)(?: my)? (?:automations|schedules)$/i, 'ls'],
  [/^(?:show|list|manage|view)(?: my)? projects$/i, 'projects'],
  [/^(?:show|list|manage|view)(?: my)? (?:agents|models|runtimes)$/i, 'runtimes'],
  [/^(?:show|list|manage|view)(?: my)? integrations$/i, 'integrations'],
  [/^(?:quit|goodbye|exit)$/i, 'exit'],
  [
    /^(?:start over|(?:start )?(?:a )?new (?:session|chat|conversation)|clear (?:the |this )?(?:chat|conversation|session|screen))$/i,
    'clear',
  ],
  [
    /^(?:sessions|(?:resume|continue|reopen|open|show|list|browse)(?: an?| my| the)? (?:earlier |previous |old |past |last )?(?:cli )?(?:sessions?|chats?|conversations?))$/i,
    'resume',
  ],
]

/**
 * Every Home command also answers to its slash form: "/ls" is "ls". A lone "/"
 * lists them all. Session commands keep the names other agent CLIs use.
 */
function slashMatches(needle: string): Choice[] {
  const name = needle.slice(1)
  if (!name) return HOME_CHOICES
  if (/\s/.test(name)) return []
  const exact = HOME_CHOICES.filter((choice) => choice.value === name)
  if (exact.length) return exact
  const alias = HOME_ALIASES.find(([pattern]) => pattern.test(name))?.[1]
  if (alias) return HOME_CHOICES.filter((choice) => choice.value === alias)
  return HOME_CHOICES.filter((choice) => choice.value.startsWith(name))
}

export function homeMatches(value: string): Choice[] {
  const needle = value.trim().toLowerCase()
  if (!needle) return []
  if (needle.startsWith('/')) return slashMatches(needle)
  const alias = HOME_ALIASES.find(([pattern]) => pattern.test(needle))?.[1]
  if (alias) return HOME_CHOICES.filter((choice) => choice.value === alias)
  const exact = HOME_CHOICES.filter(
    (choice) => choice.value === needle || choice.label.toLowerCase() === needle,
  )
  if (exact.length) return exact
  if (needle.includes(' ')) return []
  return HOME_CHOICES.filter(
    (choice) => choice.value.startsWith(needle) || choice.label.toLowerCase().startsWith(needle),
  )
}

function suggestionScore(needle: string, target: string): number {
  if (target.startsWith(needle)) return 0
  if (target.includes(needle)) return 1
  let position = 0
  for (const letter of needle) {
    position = target.indexOf(letter, position)
    if (position < 0) break
    position++
  }
  if (position >= 0) return 2

  // Allow small typos against a prefix so suggestions survive unfinished words.
  const allowance = needle.length < 7 ? 1 : 2
  if (needle.length < 4 || needle.length > target.length + allowance) return Infinity
  let previous = Array.from({ length: target.length + 1 }, (_, index) => index)
  for (let row = 0; row < needle.length; row++) {
    const current = [row + 1]
    for (let column = 0; column < target.length; column++) {
      current.push(
        Math.min(
          current[column]! + 1,
          previous[column + 1]! + 1,
          previous[column]! + (needle[row] === target[column] ? 0 : 1),
        ),
      )
    }
    previous = current
  }
  return Math.min(...previous) <= allowance ? 3 : Infinity
}

/** Match command names and labels as the user types, including abbreviations and typos. */
export function homeSuggestions(value: string): Choice[] {
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
  const needle = normalize(value)
  if (!needle) return []
  const matches = HOME_CHOICES.map((choice) => {
    const words = choice.label.split(' ')
    const targets = [choice.value, ...words.map((_, index) => words.slice(index).join(''))]
    const score = Math.min(...targets.map((target) => suggestionScore(needle, normalize(target))))
    return { choice, score }
  })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score)
    .map(({ choice }) => choice)
  return matches.length ? matches : homeMatches(value)
}

export function requestSuggestion(value: string): string {
  const input = value.trim().replace(/^openrun\s+/i, '')
  const suggestions = homeSuggestions(input)
  if (!suggestions.length) return value ? 'Reading request…' : ''
  const matches = homeMatches(input)
  const action =
    matches.length === 1
      ? matches[0]!.label
      : matches.length
        ? 'Choose a command'
        : 'Resolve request'
  const hint = `Enter → ${action}`
  return hint
}

/** Completion is an edit. Enter accepts it first; a second Enter submits. */
export function inputCompletion(
  value: string,
  history: readonly string[] = [],
): string | undefined {
  if (!value.trim()) return undefined
  const prefix = /^openrun\s+/i.exec(value)?.[0] || ''
  const input = value.slice(prefix.length)
  if (input.startsWith('/')) {
    const name = input.slice(1).toLowerCase()
    const slash = HOME_CHOICES.find(
      (choice) => name && choice.value.startsWith(name) && choice.value !== name,
    )
    return slash && `${prefix}/${slash.value}`
  }
  const exact = homeMatches(input).find(
    (choice) =>
      choice.value === input.toLowerCase() || choice.label.toLowerCase() === input.toLowerCase(),
  )
  if (exact) return undefined
  const choice = homeSuggestions(input)[0]
  if (choice) {
    const completion = choice.value.toLowerCase().startsWith(input.toLowerCase())
      ? choice.value
      : choice.label.toLowerCase().startsWith(input.toLowerCase())
        ? choice.label
        : choice.value
    return prefix + completion
  }
  return [...history].reverse().find((entry) => entry.startsWith(value) && entry !== value)
}
export class Cancelled extends Error {}
export class Back extends Error {}
export class Quit extends Error {}
export class RequestInput extends Error {
  initial: string
  readonly previous: string
  submitted = false
  cancelled = false

  constructor(initial: string, previous: string) {
    super('Enter a request')
    this.initial = initial
    this.previous = previous
  }
}
export class CommandRequest extends Error {
  readonly request: string
  /** Opened by a click rather than typed: kept out of chat and command history. */
  readonly silent: boolean

  constructor(request: string, silent = false) {
    super(request)
    this.request = request
    this.silent = silent
  }
}

export function isCommandRequest(value: string): boolean {
  const text = value.trim()
  if (text.length > 4000) return false
  return (
    /^openrun\s+\S/i.test(text) ||
    HOME_CHOICES.some((choice) => choice.value === text.toLowerCase()) ||
    HOME_ALIASES.some(([pattern]) => pattern.test(text)) ||
    (text.startsWith('/') && slashMatches(text.toLowerCase()).length === 1) ||
    /^(?:run|launch|schedule|continue|resume|show|review|cancel|worker|integrations|api)\s+\S/i.test(
      text,
    ) ||
    isImplicitRequest(text)
  )
}

/** Catch navigation only. Failed requests must never be replayed automatically. */
export async function backTo<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    if (!(error instanceof Back)) throw error
  }
}

/** Values live in the caller's draft; going back reopens only the previous step. */
export async function steps(actions: (() => Promise<void>)[]): Promise<void> {
  for (let index = 0; index < actions.length; ) {
    try {
      await actions[index]!()
      index++
    } catch (error) {
      if (!(error instanceof Back) || index === 0) throw error
      index--
    }
  }
}

/** Keep a list open after visiting an item; Escape in the list goes to its parent. */
export async function browse(
  choose: () => Promise<string>,
  visit: (choice: string) => Promise<unknown>,
): Promise<void> {
  for (;;) {
    const choice = await choose()
    if (choice === ':exit') return
    await backTo(() => visit(choice))
  }
}

export function interactiveTerminal(): boolean {
  return Boolean(
    process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY && !process.env.CI,
  )
}

export function accent(value: string): string {
  return process.stdout.isTTY &&
    process.stderr.isTTY &&
    !process.env.CI &&
    process.env.NO_COLOR === undefined &&
    process.env.TERM !== 'dumb'
    ? `\x1b[38;2;89;156;231m${value}\x1b[0m`
    : value
}

/** Interactive prompts share one screen. Script invocations never read stdin. */
export class CliUi {
  interactive: boolean
  session = false
  private terminal?: TerminalSurface
  private commandHistory?: CommandHistory
  private exitMessage = ''
  private readonly transcript: CliSession
  private statusMessage = ''

  constructor(interactive = interactiveTerminal(), transcript = new CliSession()) {
    this.interactive = interactive
    this.transcript = transcript
  }

  /** Kept across a restart, so switching requests does not start a new session. */
  get sessionState(): CliSession {
    return this.transcript
  }

  /** Earlier CLI sessions, most recent first; the current one is left out. */
  savedSessions(): SavedSession[] {
    return savedSessions(sessionsDirectory(), this.transcript.file)
  }

  /** clear: start a new transcript and an empty Activity list. */
  clearSession(): void {
    this.transcript.reset()
  }

  /** resume: show an earlier transcript and keep appending to it. */
  resumeSession(file: string): void {
    this.transcript.resume(file)
  }

  async start(): Promise<void> {
    if (!this.interactive || this.terminal) return
    const { TerminalSurface } = await import('./terminal.ts')
    this.terminal = await TerminalSurface.create(this.transcript)
    this.terminal.setStatus(this.statusMessage)
  }

  intro(): void {}

  info(message: string): void {
    if (this.terminal) this.terminal.info(message)
    else console.error(message)
  }

  note(message: string, title = 'Ready to run'): void {
    if (this.terminal) this.terminal.note(message, title)
    else console.error(`${title}\n${message}`)
  }

  scheduledTasks(tasks: ScheduledTaskView[]): void {
    this.overview({ tasks })
  }

  overview(view: HomeOverview): void {
    this.transcript.updateOverview(view)
  }

  scheduleSaved(task: ScheduledTaskView): void {
    if (!this.interactive) return
    const tasks = this.transcript.overview.tasks || []
    const exists = tasks.some((row) => row.id === task.id)
    this.overview({
      tasks: [...tasks.filter((row) => row.id !== task.id), task],
      scheduled: (this.transcript.overview.scheduled ?? tasks.length) + (exists ? 0 : 1),
    })
  }

  runStarted(run: OverviewRow): void {
    if (!this.interactive) return
    const runs = this.transcript.overview.activeRuns || []
    if (runs.some((row) => row.id === run.id)) return
    this.overview({
      activeRuns: [...runs, run],
      running: (this.transcript.overview.running ?? 0) + 1,
    })
  }

  runChanged(id: string, status: string): void {
    this.transcript.runChanged(id, status)
  }

  takeRunsAwaitingChanges(): string[] {
    return this.interactive ? this.transcript.takeRunsAwaitingChanges() : []
  }

  runChanges(id: string, changes: RunChanges): void {
    this.transcript.runChanges(id, changes)
  }

  /** Show a run's changes in place of the panels until `endReview`. */
  async review(
    view: ReviewView,
    loadDiff: (path: string, whole: boolean) => Promise<string>,
  ): Promise<ReviewAction> {
    if (!this.interactive) throw new Error('Review needs an interactive terminal.')
    await this.start()
    return this.terminal!.review(view, loadDiff)
  }

  endReview(): void {
    this.terminal?.endReview()
  }

  done(message: string): void {
    if (!this.session) this.exitMessage = message
    if (this.terminal) this.terminal.info(message)
    else console.error(message)
  }

  /** What a request started, attached under its prompt in the chat. */
  statusCard(card: StatusCard): void {
    if (this.terminal) this.transcript.card(card)
    else console.error(cardText(card))
  }

  status(message: string): void {
    this.statusMessage = message
    this.terminal?.setStatus(message)
  }

  beginAction(request?: string): void {
    this.transcript.begin(request)
    this.terminal?.beginAction()
  }

  progress(message: string): void {
    this.transcript.progress(message)
  }

  finishAction(message?: string): void {
    this.transcript.finish(message)
    this.terminal?.endAction()
  }

  async presentOutput(): Promise<void> {
    if (this.session) return
    if (this.terminal?.hasUnreadOutput)
      await this.select('Ready to continue?', [{ value: 'home', label: 'Back to Home' }])
  }

  async homeRequest(initial = ''): Promise<string> {
    if (!this.interactive) throw new Error('Home needs an interactive terminal.')
    await this.start()
    const history = this.history()
    const command = await this.terminal!.homeRequest(history.commands, initial)
    history.remember(command)
    return command
  }

  private history(): CommandHistory {
    if (!this.commandHistory) this.commandHistory = new CommandHistory()
    return this.commandHistory
  }

  close(): void {
    this.terminal?.close(this.exitMessage)
    this.terminal = undefined
  }

  /** Only one application may own raw input and the alternate screen at a time. */
  async handoff<T>(action: () => Promise<T>): Promise<T> {
    this.terminal?.close(undefined, false)
    this.terminal = undefined
    try {
      return await action()
    } finally {
      if (this.session) await this.start()
    }
  }

  async select(
    message: string,
    options: Choice[],
    initialValue = options[0]?.value,
  ): Promise<string> {
    if (!this.interactive) throw new Error(`${message} Supply an explicit option in scripts.`)
    if (!options.length) throw new Error(`No choices available for: ${message}`)
    await this.start()
    return this.prompt(
      (initial) => this.terminal!.select(message, options, initial),
      initialValue ?? '',
    )
  }

  async text(
    message: string,
    initialValue = '',
    validate?: (value: string) => string | undefined,
    optional = false,
  ): Promise<string> {
    if (!this.interactive) throw new Error(`${message} Supply an explicit value in scripts.`)
    await this.start()
    return this.prompt(
      (initial) => this.terminal!.text(message, initial, validate, optional),
      initialValue,
    )
  }

  /** A new request unwinds the current flow before the CLI dispatches it once. */
  private async prompt(
    show: (initial: string) => Promise<string>,
    initial: string,
  ): Promise<string> {
    for (;;) {
      try {
        return await show(initial)
      } catch (error) {
        if (!(error instanceof RequestInput)) {
          if (error instanceof CommandRequest && !error.silent) {
            this.history().remember(error.request)
          }
          throw error
        }
        initial = error.previous
        if (error.cancelled) continue
        if (error.submitted && error.initial.trim()) {
          const request = error.initial.trim()
          this.history().remember(request)
          throw new CommandRequest(request)
        }
        const request = await backTo(() => this.homeRequest(error.initial))
        if (request !== undefined) throw new CommandRequest(request)
      }
    }
  }

  async confirm(message: string, initialValue = true): Promise<boolean> {
    return (
      (await this.select(
        message,
        [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
        initialValue ? 'yes' : 'no',
      )) === 'yes'
    )
  }

  get preferredRuntime(): string {
    try {
      const prefs = JSON.parse(readFileSync(join(openrunHome(), 'cli-preferences.json'), 'utf8'))
      return typeof prefs.runtimeId === 'string' ? prefs.runtimeId : ''
    } catch {
      return ''
    }
  }

  rememberRuntime(runtimeId: string): void {
    if (!this.interactive) return
    try {
      const home = openrunHome()
      mkdirSync(home, { recursive: true, mode: 0o700 })
      writeFileSync(join(home, 'cli-preferences.json'), JSON.stringify({ runtimeId }), {
        mode: 0o600,
      })
    } catch {
      /* Remembering a preference must not fail a successful run. */
    }
  }
}

export type FlowUi = Pick<
  CliUi,
  'interactive' | 'info' | 'note' | 'select' | 'text' | 'confirm' | 'preferredRuntime'
>

export function commandMenu(ui: FlowUi, initialValue?: string): Promise<string> {
  return ui.select('Home · what would you like to do?', HOME_CHOICES, initialValue)
}
