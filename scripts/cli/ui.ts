import * as prompts from '@clack/prompts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openrunHome } from '../../src/server/paths.ts'

export type Choice = { value: string; label: string; hint?: string }
export class Cancelled extends Error {}

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

/** Every prompt uses stderr. JSON and unattended invocations never read stdin. */
export class CliUi {
  interactive: boolean
  private started = false

  constructor(interactive = interactiveTerminal()) {
    this.interactive = interactive
  }

  intro(): void {
    if (this.started || !this.interactive) return
    this.started = true
    prompts.intro(`${accent('Open Run')}  /  your agents, on your machine`, {
      output: process.stderr,
    })
  }

  info(message: string): void {
    if (this.interactive) prompts.log.info(message, { output: process.stderr })
    else console.error(message)
  }

  note(message: string, title = 'Ready to run'): void {
    if (this.interactive) prompts.note(message, title, { output: process.stderr })
    else console.error(`${title}\n${message}`)
  }

  done(message: string): void {
    if (this.interactive) prompts.outro(message, { output: process.stderr })
    else console.error(message)
  }

  async select(
    message: string,
    options: Choice[],
    initialValue = options[0]?.value,
  ): Promise<string> {
    if (!this.interactive) throw new Error(`${message} Supply an explicit option in scripts.`)
    if (!options.length) throw new Error(`No choices available for: ${message}`)
    this.intro()
    const answer = await prompts.select({
      message,
      options,
      initialValue,
      maxItems: 7,
      output: process.stderr,
    })
    if (prompts.isCancel(answer)) throw new Cancelled('Cancelled.')
    return answer
  }

  async text(
    message: string,
    initialValue = '',
    validate?: (value: string) => string | undefined,
    optional = false,
  ): Promise<string> {
    if (!this.interactive) throw new Error(`${message} Supply an explicit value in scripts.`)
    this.intro()
    const answer = await prompts.text({
      message,
      initialValue,
      output: process.stderr,
      validate: (value) => {
        const input = (value ?? '').trim()
        if (!input && !optional) return 'Enter a value to continue, or press Ctrl+C to leave.'
        return validate?.(input)
      },
    })
    if (prompts.isCancel(answer)) throw new Cancelled('Cancelled.')
    return answer.trim()
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

export function commandMenu(ui: FlowUi): Promise<string> {
  return ui.select('What would you like to do?', [
    { value: 'run', label: 'Run a task', hint: 'start now, or choose a schedule' },
    { value: 'schedule', label: 'Schedule an automation' },
    { value: 'runs', label: 'Recent runs' },
    { value: 'ls', label: 'Manage automations' },
    { value: 'init', label: 'Set up a project' },
    { value: 'integrations', label: 'Connect an issue tracker' },
    { value: 'runtimes', label: 'Choose and configure agents' },
    { value: 'worker', label: 'Manage the background worker' },
    { value: 'api', label: 'Browse application operations' },
    { value: 'help', label: 'Command reference' },
    { value: 'exit', label: 'Done' },
  ])
}
