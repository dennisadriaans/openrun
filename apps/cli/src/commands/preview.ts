import { readCliLine } from './args.ts'
import { homeSuggestions, requestSuggestion } from '../terminal/ui.ts'
import { parseCliSchedule } from './cliSchedule.ts'
import { modelKindForBin, modelsForKind } from '@openrun/domain/runtimes/models'
import { resolveNativeModel, type InterpretedIntent } from './natural.ts'
import { NATIVE_RUNTIMES, isNativeRuntime } from './agentSelection.ts'

const actionLabels: Record<string, string> = {
  runs: 'View recent runs',
  ls: 'Manage automations',
  projects: 'View projects',
  runtimes: 'View agents and models',
  integrations: 'Manage integrations',
  worker: 'Manage background worker',
  resume: 'Continue a run',
  init: 'Set up a project',
  help: 'Show help',
  show: 'View run details',
  cancel: 'Cancel a run',
  now: 'Start an automation now',
  enable: 'Enable an automation',
  disable: 'Pause an automation',
  rm: 'Remove an automation',
  where: 'Show connection details',
  login: 'Sign in',
  api: 'Review an application operation',
}

export function describeIntent(result: InterpretedIntent, dryRun = false): string {
  const { action, intent } = result
  if (result.clarify.includes('action'))
    return 'Enter → Choose how to handle this request\nThe action still needs clarification'
  if (action !== 'launch' && action !== 'schedule')
    return `Enter → ${actionLabels[action] || action}`
  const runtime = isNativeRuntime(intent.runtimeHint)
    ? NATIVE_RUNTIMES[intent.runtimeHint].label
    : intent.runtimeHint || 'Choose agent'
  const model = resolveNativeModel(
    intent.modelHint,
    modelsForKind(modelKindForBin(intent.runtimeHint)),
  )
  const choices = result.clarify
    .filter((field) => field !== 'schedule' || action === 'schedule')
    .map((field) => (field === 'schedule' ? 'time' : field === 'prompt' ? 'task' : field))
  const schedule = intent.schedule
  const timing =
    result.scheduleText ||
    (schedule.kind === 'once'
      ? new Date(schedule.at).toLocaleString(undefined, { hour12: false })
      : schedule.kind === 'recurring'
        ? `Repeats ${schedule.cron}`
        : 'Choose time')
  const next = choices.length
    ? `Review ${action === 'schedule' ? 'schedule' : 'request'}`
    : action === 'schedule'
      ? `Schedule · ${timing}`
      : `Open ${runtime} now`
  const details = [
    ...(action === 'schedule' ? [runtime] : []),
    model?.shortName || intent.modelHint || 'Default model',
    intent.effortHint ? `${intent.effortHint} effort` : 'Default effort',
    choices.length ? `Choose ${choices.join(', ')}` : intent.prompt || 'Interactive session',
  ]
  return `Enter → ${dryRun ? 'Preview only · ' : ''}${next}\n${details.join(' · ')}`
}

/** Interpret without starting a worker, asking questions, or performing work. */
export async function previewRequest(
  value: string,
  signal: AbortSignal,
  interpreting: () => void,
): Promise<string> {
  const input = value.trim().replace(/^openrun\s+/i, '')
  const { command, help, flags } = readCliLine(input)
  if (help) return 'Enter → Show help'
  if (command === 'run')
    return 'Enter → Set up a managed run\nReview the task, agent and workspace before starting'
  if (command === 'schedule') {
    if (!flags.rest.length) return 'Enter → Set up a schedule\nChoose a task, time and agent'
    const parsed = parseCliSchedule(flags.rest, new Date(), { allowEmptyPrompt: true })
    const explicit = flags.rest.some(
      (word) => word === '--' || /^--(runtime|model|effort|prompt|cron)(=|$)/.test(word),
    )
    if (flags.url || explicit) {
      if (parsed.ok && parsed.intent.schedule.kind !== 'now')
        return describeIntent(
          { action: 'schedule', intent: parsed.intent, clarify: [] },
          flags.dryRun,
        )
      return 'Enter → Set up a schedule\nReview the task, time and agent'
    }
  } else if (command !== 'launch') {
    return `Enter → ${actionLabels[command] || command}${flags.rest.length ? ` · ${flags.rest.join(' ')}` : ''}`
  }
  if (flags.url) return 'Native agents open on this machine. Remove --url to continue.'
  const { previewNativeIntent } = await import('./native.ts')
  signal.throwIfAborted()
  const result = await previewNativeIntent(
    flags.rest,
    command === 'schedule' ? 'schedule' : 'auto',
    signal,
    interpreting,
  )
  return describeIntent(result, flags.dryRun)
}

/** Debounce typing and ignore replies for text that has already changed. */
export class RequestPreview {
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private show: (message: string) => void
  private resolve: typeof previewRequest

  constructor(show: (message: string) => void, resolve = previewRequest) {
    this.show = show
    this.resolve = resolve
  }

  update(value: string): void {
    this.cancel()
    const text = value.trim()
    this.show(requestSuggestion(text))
    if (!text || homeSuggestions(text.replace(/^openrun\s+/i, '')).length) return
    const controller = new AbortController()
    this.controller = controller
    const show = (message: string) => {
      if (!controller.signal.aborted) this.show(message)
    }
    this.timer = setTimeout(async () => {
      show('Reading request…')
      try {
        show(
          await this.resolve(text, controller.signal, () => {
            show('Interpreting with TypeSafe…\nOnly this request and model choices are sent')
          }),
        )
      } catch (error) {
        show(
          `Enter → Resolve request on submit\n${error instanceof Error ? error.message : 'Preview unavailable'}`,
        )
      }
    }, 600)
  }

  cancel(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.controller?.abort()
    this.controller = undefined
  }
}
