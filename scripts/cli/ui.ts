import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalSurface } from './terminal.ts'
import { openrunHome } from '../../src/server/paths.ts'
import { CommandHistory } from './history.ts'
import { isImplicitRequest } from './natural.ts'

export type Choice = { value: string; label: string; hint?: string }
export type ScheduledTaskView = { id: string; prompt: string; when: string }
const HOME_CHOICES: Choice[] = [
  { value: 'launch', label: 'Open a coding agent' },
  { value: 'run', label: 'Run a task' },
  { value: 'schedule', label: 'Schedule an automation' },
  { value: 'runs', label: 'Recent runs' },
  { value: 'resume', label: 'Continue a run' },
  { value: 'ls', label: 'Manage automations' },
  { value: 'init', label: 'Set up a project' },
  { value: 'integrations', label: 'Manage integrations' },
  { value: 'projects', label: 'Projects' },
  { value: 'runtimes', label: 'Agents and models' },
  { value: 'worker', label: 'Background worker' },
  { value: 'api', label: 'Application operations' },
  { value: 'help', label: 'Help' },
  { value: 'refresh', label: 'Refresh overview' },
  { value: 'exit', label: 'Quit' },
]
const HOME_ALIASES: [RegExp, string][] = [
  [/^(?:show|list|view|see)(?: me)? (?:recent |active )?runs?$/i, 'runs'],
  [/^(?:show|list|manage|view)(?: my)? (?:automations|schedules)$/i, 'ls'],
  [/^(?:show|list|manage|view)(?: my)? projects$/i, 'projects'],
  [/^(?:show|list|manage|view)(?: my)? (?:agents|models|runtimes)$/i, 'runtimes'],
  [/^(?:show|list|manage|view)(?: my)? integrations$/i, 'integrations'],
  [/^(?:quit|goodbye|exit)$/i, 'exit'],
]

export function homeMatches(value: string): Choice[] {
  const needle = value.trim().toLowerCase()
  if (!needle) return []
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

/** Keep relevant choices visible even when one command already matches exactly. */
export function homeSuggestions(value: string): Choice[] {
  const needle = value.trim().toLowerCase()
  if (!needle) return []
  const matches = HOME_CHOICES.filter(
    (choice) => choice.value.startsWith(needle) || choice.label.toLowerCase().startsWith(needle),
  )
  return matches.length ? matches : homeMatches(needle)
}

export function requestSuggestion(value: string): string {
  const input = value.trim().replace(/^openrun\s+/i, '')
  const suggestions = homeSuggestions(input)
  if (!suggestions.length) return value ? 'Reading request…' : ''
  const matches = homeMatches(input)
  const action =
    matches.length === 1
      ? matches[0]!.label
      : suggestions.length === 1
        ? suggestions[0]!.label
        : 'Choose a command'
  const hint = `Enter → ${action}`
  return suggestions.length === 1
    ? hint
    : `${hint}\n${suggestions
        .slice(0, 4)
        .map((choice) => choice.label)
        .join(' · ')}`
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

  constructor(request: string) {
    super(request)
    this.request = request
  }
}

export function isCommandRequest(value: string): boolean {
  const text = value.trim()
  if (text.length > 4000) return false
  return (
    /^openrun\s+\S/i.test(text) ||
    HOME_CHOICES.some((choice) => choice.value === text.toLowerCase()) ||
    HOME_ALIASES.some(([pattern]) => pattern.test(text)) ||
    /^(?:run|launch|schedule|resume|show|cancel|worker|integrations|api)\s+\S/i.test(text) ||
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
    ? `\x1b[36m${value}\x1b[0m`
    : value
}

/** Interactive prompts share one screen. Script invocations never read stdin. */
export class CliUi {
  interactive: boolean
  session = false
  private terminal?: TerminalSurface
  private commandHistory?: CommandHistory
  private exitMessage = ''

  constructor(interactive = interactiveTerminal()) {
    this.interactive = interactive
  }

  async start(): Promise<void> {
    if (!this.interactive || this.terminal) return
    const { TerminalSurface } = await import('./terminal.ts')
    this.terminal = await TerminalSurface.create()
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
    this.terminal?.scheduledTasks(tasks)
  }

  done(message: string): void {
    if (!this.session) this.exitMessage = message
    if (this.terminal) this.terminal.info(message)
    else console.error(message)
  }

  status(message: string): void {
    this.terminal?.setStatus(message)
  }

  beginAction(): void {
    this.terminal?.beginAction()
  }

  async presentOutput(): Promise<void> {
    if (this.terminal?.hasUnreadOutput)
      await this.select('Ready to continue?', [{ value: 'home', label: 'Back to Home' }])
  }

  async homeRequest(initial = ''): Promise<string> {
    if (!this.interactive) throw new Error('Home needs an interactive terminal.')
    await this.start()
    const history = (this.commandHistory ??= new CommandHistory())
    const command = await this.terminal!.homeRequest(history.commands, initial)
    history.remember(command)
    return command
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
          if (error instanceof CommandRequest) {
            ;(this.commandHistory ??= new CommandHistory()).remember(error.request)
          }
          throw error
        }
        initial = error.previous
        if (error.cancelled) continue
        if (error.submitted && error.initial.trim()) {
          const request = error.initial.trim()
          const history = (this.commandHistory ??= new CommandHistory())
          history.remember(request)
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
