import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  applyPromptEffort,
  cliEffortValue,
  defaultEffort,
  modelsForKind,
} from '@openrun/domain/runtimes/models'
import { deriveTaskName, parseCliSchedule, type CliSchedule } from './cliSchedule.ts'
import { nativeModelsForBin } from '@openrun/runtime/runtimes/modelCatalog'
import { checkRuntimeInstalled } from '@openrun/runtime/runtimes/runtimePath'
import { openrunHome } from '@openrun/runtime/paths'
import {
  interpretRequest,
  isImplicitRequest,
  parseLocalAgent,
  parseLocalRequest,
  requestAction,
  resolveNativeModel,
  scheduleFromText,
  splitScheduledTask,
  type NativeCatalog,
  type NativeRuntime,
  type LaunchPreference,
  type InterpretedIntent,
} from './natural.ts'
import {
  NATIVE_RUNTIMES,
  interpreterModels,
  isNativeRuntime,
  matchNativeModel,
  resolveNativeEffort,
  resolveNativeRuntime,
} from './agentSelection.ts'
import { accent, type CliUi, interactiveTerminal } from '../terminal/ui.ts'
import type { GlobalFlags } from './args.ts'

export type NativeLaunch = {
  runtime: NativeRuntime
  binary?: string
  model: string
  effort: string
  prompt: string
  cwd: string
  sessionId?: string
}

function preference(): LaunchPreference | undefined {
  try {
    const value = JSON.parse(readFileSync(join(openrunHome(), 'launch-preferences.json'), 'utf8'))
    if (
      isNativeRuntime(value.runtime) &&
      typeof value.model === 'string' &&
      typeof value.effort === 'string'
    )
      return value
  } catch {
    /* First launch uses the native agent's defaults. */
  }
}

function remember(value: LaunchPreference): void {
  try {
    mkdirSync(openrunHome(), { recursive: true, mode: 0o700 })
    writeFileSync(join(openrunHome(), 'launch-preferences.json'), JSON.stringify(value), {
      mode: 0o600,
    })
  } catch {
    /* Preferences must not prevent a successful launch. */
  }
}

let catalogCache: { expires: number; value: Promise<NativeCatalog[]> } | undefined

async function catalogs(): Promise<NativeCatalog[]> {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.value
  const installed = (Object.keys(NATIVE_RUNTIMES) as NativeRuntime[]).filter(
    (runtime) => checkRuntimeInstalled(NATIVE_RUNTIMES[runtime].bin).installed,
  )
  const value = Promise.all(
    installed.map(async (runtime) => ({
      runtime,
      models: await nativeModelsForBin(NATIVE_RUNTIMES[runtime].bin),
    })),
  )
  catalogCache = { expires: Date.now() + 30_000, value }
  return value
}

/** Explicit controls never go through the hosted interpreter. */
function launchInput(words: string[]) {
  const explicit: Record<string, string> = {}
  const text: string[] = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]!
    if (word === '--') {
      explicit.prompt = words.slice(index + 1).join(' ')
      break
    }
    if (word.startsWith('--')) {
      const equals = word.indexOf('=')
      const key = word.slice(2, equals < 0 ? undefined : equals)
      explicit[key] = equals < 0 ? (words[++index] ?? '') : word.slice(equals + 1)
    } else text.push(word)
  }
  return { explicit, text: text.join(' '), words: text }
}

/** Preview and submission resolve the same request; only submission may ask questions. */
async function readNativeIntent(
  words: string[],
  mode: 'auto' | 'schedule',
  {
    signal,
    info = () => {},
    interpreting = info,
    recover = false,
  }: {
    signal?: AbortSignal
    info?: (message: string) => void
    /** The typed line is about to leave the machine; the preview already said so. */
    interpreting?: (message: string) => void
    recover?: boolean
  } = {},
) {
  const available = await catalogs()
  signal?.throwIfAborted()
  const saved = preference()
  const { explicit, text, words: textWords } = launchInput(words)
  const blank = parseCliSchedule([], new Date(), { allowEmptyPrompt: true })
  if (!blank.ok) throw new Error(blank.error)
  let interpreted: InterpretedIntent = {
    action: mode === 'schedule' ? 'schedule' : 'launch',
    intent: blank.intent,
    clarify: [],
  }
  // Explicit agent controls make remaining text literal. A separate --prompt
  // never leaves the machine, even when natural model controls need interpretation.
  const explicitAgent =
    explicit.runtime !== undefined || explicit.model !== undefined || explicit.effort !== undefined
  const localRequest =
    text && (!explicitAgent || mode === 'schedule')
      ? parseLocalRequest(textWords, available, mode)
      : undefined
  if (localRequest) {
    interpreted = localRequest
  } else if (text && !explicitAgent) {
    interpreting(
      'Interpreting with Open Run + TypeSafe. Only this request and model choices are sent.',
    )
    try {
      interpreted = await interpretRequest(
        text,
        interpreterModels(available, text, saved),
        mode,
        saved,
        signal,
      )
    } catch (error) {
      if (!recover || signal?.aborted) throw error
      info(
        `${error instanceof Error ? error.message : 'Could not interpret the request.'} Your request is kept below.`,
      )
      interpreted.clarify =
        mode === 'schedule'
          ? ['model', 'effort', 'prompt', 'schedule']
          : ['action', 'model', 'effort', 'prompt']
      interpreted.intent.prompt = text
    }
  } else if (text && explicit.prompt === undefined) {
    interpreted.intent.prompt = text
  }
  // A time or task that needs clarification must not erase a stated agent or
  // effort. Local catalog matches take precedence over hosted uncertainty.
  const localAgent = !explicitAgent ? parseLocalAgent(textWords, available) : undefined
  const known = !localRequest ? localAgent?.selection : undefined
  if (known) {
    interpreted.intent.runtimeHint = known.runtime
    interpreted.intent.modelHint = known.model
    if (known.hasEffort) interpreted.intent.effortHint = known.effort
    if (interpreted.clarify.includes('prompt') && localAgent)
      interpreted.intent.prompt = localAgent.prompt
    interpreted.clarify = interpreted.clarify.filter(
      (field) => !(field === 'model' && known.model) && !(field === 'effort' && known.hasEffort),
    )
  }
  // The time is usually stated at either end. Split it locally before asking,
  // so neither the task nor the time needs to be typed again.
  const unsettled =
    !localRequest &&
    explicit.prompt === undefined &&
    (interpreted.action === 'launch' || interpreted.action === 'schedule') &&
    (interpreted.clarify.includes('prompt') ||
      interpreted.clarify.includes('schedule') ||
      interpreted.intent.schedule.kind === 'now') &&
    (mode === 'schedule' || requestAction(text, mode) === 'schedule')
  const split = unsettled ? splitScheduledTask(localAgent?.prompt || text) : undefined
  if (split) {
    interpreted.intent.prompt = split.prompt
    interpreted.intent.schedule = split.schedule
    interpreted.intent.name = deriveTaskName(split.prompt)
    interpreted.scheduleText = split.scheduleText
    interpreted.clarify = interpreted.clarify.filter(
      (field) => field !== 'prompt' && field !== 'schedule',
    )
  }
  if (interpreted.clarify.includes('action') && (known || split || isImplicitRequest(text))) {
    const action = requestAction(text, mode)
    if (action) {
      interpreted.action = interpreted.intent.schedule.kind !== 'now' ? 'schedule' : action
      interpreted.clarify = interpreted.clarify.filter((field) => field !== 'action')
    }
  }
  const { intent } = interpreted
  intent.runtimeHint = explicit.runtime ?? intent.runtimeHint
  intent.runtimeHint = resolveNativeRuntime(intent.runtimeHint) ?? intent.runtimeHint
  intent.modelHint = explicit.model ?? intent.modelHint
  intent.effortHint = explicit.effort ?? intent.effortHint
  intent.workspaceHint = explicit.in ?? explicit.workspace ?? intent.workspaceHint
  intent.prompt = explicit.prompt ?? intent.prompt
  if (explicit.name) intent.name = explicit.name
  const hasExplicitEffort =
    explicit.effort !== undefined || localAgent?.selection?.hasEffort === true
  return { interpreted, available, saved, explicit, hasExplicitEffort }
}

function selectedCatalog(
  intent: InterpretedIntent['intent'],
  available: NativeCatalog[],
  saved?: LaunchPreference,
) {
  let catalog = available.find((row) => row.runtime === intent.runtimeHint)
  if (intent.runtimeHint && !catalog)
    throw new Error(
      `${intent.runtimeHint} is not available. Install its CLI or choose ${available.map((row) => NATIVE_RUNTIMES[row.runtime].label).join(', ')}.`,
    )
  if (!catalog && intent.modelHint) {
    const match = matchNativeModel(intent.modelHint, available)
    if (match) catalog = available.find((row) => row.runtime === match.runtime)
  }
  return (
    catalog ??
    available.find((row) => row.runtime === saved?.runtime) ??
    (available.length === 1 ? available[0] : undefined)
  )
}

function readSchedule(text = ''): CliSchedule | undefined {
  try {
    return scheduleFromText(text)
  } catch {
    return undefined
  }
}

/** Read-only: report missing choices instead of opening prompts or starting work. */
export async function previewNativeIntent(
  words: string[],
  mode: 'auto' | 'schedule',
  signal: AbortSignal,
  info: (message: string) => void,
) {
  const { interpreted, available, saved, explicit, hasExplicitEffort } = await readNativeIntent(
    words,
    mode,
    { signal, info },
  )
  if (!['launch', 'schedule'].includes(interpreted.action)) return interpreted
  const { intent } = interpreted
  let clarify = interpreted.clarify.filter((field) => explicit[field] === undefined)
  if (!available.length) throw new Error('Install and sign in to a supported coding agent first.')
  const catalog = selectedCatalog(intent, available, saved)
  if (!catalog) {
    clarify.push('agent')
  } else {
    const requestedRuntime = Boolean(intent.runtimeHint)
    intent.runtimeHint = catalog.runtime
    if (
      !intent.modelHint &&
      !requestedRuntime &&
      saved?.runtime === catalog.runtime &&
      resolveNativeModel(saved.model, catalog.models)
    )
      intent.modelHint = saved.model
    const model = resolveNativeModel(intent.modelHint, catalog.models)
    if (intent.modelHint && !model) clarify.push('model')
    if (model) {
      intent.modelHint = model.slug
      clarify = clarify.filter((field) => field !== 'model')
    }
    if (intent.effortHint)
      intent.effortHint =
        resolveNativeEffort(intent.effortHint, catalog.models) ?? intent.effortHint
    if (!intent.effortHint && !hasExplicitEffort)
      intent.effortHint =
        saved?.runtime === catalog.runtime && saved.model === intent.modelHint
          ? saved.effort
          : model
            ? defaultEffort(model)
            : ''
    const effortModel = model ?? catalog.models.find((row) => row.preferred) ?? catalog.models[0]
    clarify = clarify.filter((field) => field !== 'effort')
    if (intent.effortHint && !effortModel?.efforts.some((row) => row.value === intent.effortHint))
      clarify.push('effort')
  }
  if (interpreted.action === 'schedule') {
    if (!intent.prompt) clarify.push('prompt')
    if (intent.schedule.kind === 'now') clarify.push('schedule')
  }
  interpreted.clarify = [...new Set(clarify)]
  return interpreted
}

export async function prepareNativeIntent(
  words: string[],
  ui: CliUi,
  mode: 'auto' | 'schedule' = 'auto',
): Promise<InterpretedIntent> {
  const input = await readNativeIntent(words, mode, {
    info: (message) => ui.info(message),
    interpreting: (message) =>
      ui.session ? ui.progress('Interpreting request') : ui.info(message),
    recover: ui.interactive,
  })
  return completeNativeIntent(input, ui, mode)
}

/** Ask only for unresolved fields, then return directly to launch or scheduling. */
export async function completeNativeIntent(
  {
    interpreted,
    available,
    saved,
    explicit,
    hasExplicitEffort,
  }: Awaited<ReturnType<typeof readNativeIntent>>,
  ui: Pick<CliUi, 'interactive' | 'select' | 'text'>,
  mode: 'auto' | 'schedule' = 'auto',
): Promise<InterpretedIntent> {
  let { action } = interpreted
  const { intent, clarify } = interpreted
  if (action !== 'launch' && action !== 'schedule' && !clarify.includes('action'))
    return { action, intent, clarify: [] }
  if (clarify.includes('action') && mode !== 'schedule')
    action = (await ui.select('Open the agent now, or schedule work?', [
      { value: 'launch', label: 'Open the agent now' },
      { value: 'schedule', label: 'Schedule work' },
    ])) as 'launch' | 'schedule'
  if (!available.length)
    throw new Error(
      'Install and sign in to a supported agent (Codex, Claude Code, Grok, Gemini, Antigravity or fx), then try again.',
    )
  let catalog = selectedCatalog(intent, available, saved)
  if (!catalog) {
    const runtime = await ui.select(
      'Which agent?',
      available.map((row) => ({ value: row.runtime, label: NATIVE_RUNTIMES[row.runtime].label })),
    )
    catalog = available.find((row) => row.runtime === runtime)!
  }
  const requestedRuntime = Boolean(intent.runtimeHint)
  intent.runtimeHint = catalog.runtime
  if (
    !intent.modelHint &&
    !requestedRuntime &&
    saved?.runtime === catalog.runtime &&
    resolveNativeModel(saved.model, catalog.models)
  )
    intent.modelHint = saved.model
  let model = resolveNativeModel(intent.modelHint, catalog.models)
  if ((intent.modelHint && !model) || (clarify.includes('model') && !model && !explicit.model)) {
    if (!ui.interactive)
      throw new Error(`Unknown model: ${intent.modelHint}. Use an available model ID with --model.`)
    intent.modelHint = await ui.select('Which model?', [
      { value: '', label: 'Agent default' },
      ...catalog.models.map((row) => ({ value: row.slug, label: row.name })),
    ])
    model = resolveNativeModel(intent.modelHint, catalog.models)
  }
  if (model) intent.modelHint = model.slug
  const effortModel = model ?? catalog.models.find((row) => row.preferred) ?? catalog.models[0]
  if (intent.effortHint)
    intent.effortHint = resolveNativeEffort(intent.effortHint, catalog.models) ?? intent.effortHint
  if (!intent.effortHint && !hasExplicitEffort)
    intent.effortHint =
      saved?.runtime === catalog.runtime && saved.model === intent.modelHint
        ? saved.effort
        : model
          ? defaultEffort(model)
          : ''
  const efforts = effortModel?.efforts ?? []
  if (intent.effortHint && !efforts.some((row) => row.value === intent.effortHint)) {
    if (!ui.interactive)
      throw new Error(
        `Unsupported effort for ${effortModel?.name || NATIVE_RUNTIMES[catalog.runtime].label}: ${intent.effortHint}. ${efforts.length ? `Choose ${efforts.map((row) => row.value || 'default').join(', ')}.` : 'Use the agent default (omit --effort).'}`,
      )
    intent.effortHint = await ui.select('Which reasoning effort?', [
      { value: '', label: 'Agent default' },
      ...efforts.map((row) => ({ value: row.value, label: row.label })),
    ])
  }
  // A known value is used as-is; only missing ones are asked for. A prefilled
  // question would otherwise cost an extra Enter for an answer we already have.
  if (
    (clarify.includes('prompt') && explicit.prompt === undefined && !intent.prompt) ||
    (action === 'schedule' && !intent.prompt)
  )
    intent.prompt = await ui.text(
      'Task for the agent (leave empty to open a session)',
      intent.prompt,
      undefined,
      action === 'launch',
    )
  if (action === 'schedule' && intent.schedule.kind === 'now') {
    const stated = readSchedule(interpreted.scheduleText)
    if (stated) intent.schedule = stated
    else
      intent.schedule = scheduleFromText(
        await ui.text(
          'When should it run?',
          interpreted.scheduleText || 'in 10 minutes',
          (value) => {
            try {
              scheduleFromText(value)
            } catch (error) {
              return (error as Error).message
            }
          },
        ),
      )
  }
  intent.name = explicit.name || deriveTaskName(intent.prompt)
  return { action, intent, clarify: [] }
}

export function nativeArgs(input: NativeLaunch): string[] {
  const args: string[] = []
  if (input.sessionId) {
    if (input.runtime === 'codex') args.push('resume', input.sessionId)
    else if (input.runtime === 'antigravity') args.push('--conversation', input.sessionId)
    else args.push('--resume', input.sessionId)
  } else if (input.runtime === 'fx' && input.prompt) args.push('ask')
  if (input.runtime === 'codex') args.push('--yolo')
  if (input.runtime === 'claude') args.push('--dangerously-skip-permissions')
  if (input.model) args.push('--model', input.model)
  const model = resolveNativeModel(input.model, modelsForKind(input.runtime))
  const injected = input.runtime === 'claude' && input.effort === 'ultrathink'
  const effort = injected ? null : cliEffortValue(input.runtime, model, input.effort)
  if (effort) {
    if (input.runtime === 'codex')
      args.push('-c', `model_reasoning_effort=${JSON.stringify(effort)}`)
    else if (input.runtime === 'grok') args.push('--reasoning-effort', effort)
    else if (input.runtime === 'gemini')
      throw new Error('Gemini CLI has no reasoning effort flag. Use the agent default.')
    else args.push('--effort', effort)
  }
  if (input.prompt) {
    const prompt = injected
      ? applyPromptEffort(input.prompt, input.effort, { isFollowUp: Boolean(input.sessionId) })
      : input.prompt
    if (input.runtime === 'antigravity' || input.runtime === 'gemini')
      args.push('--prompt-interactive', prompt)
    else args.push('--', prompt)
  }
  return args
}

function discovery(input: NativeLaunch): void {
  if (!interactiveTerminal()) return
  console.info(
    accent(
      [
        `\nOpen Run · ${NATIVE_RUNTIMES[input.runtime].label} · ${input.model || 'default model'} · ${input.effort || 'default effort'}`,
        `Run later: openrun schedule in 10 minutes "your task" using ${input.model || input.runtime}${input.effort ? ` ${input.effort}` : ''}`,
        'Explore: openrun automations · openrun runs · openrun help\n',
      ].join('\n'),
    ),
  )
}

export async function launchNative(
  input: NativeLaunch,
  flags: GlobalFlags,
  ui: CliUi,
): Promise<number> {
  const binary = checkRuntimeInstalled(input.binary || NATIVE_RUNTIMES[input.runtime].bin)
  if (!binary.installed) throw new Error(`Install and sign in to ${input.runtime} first.`)
  const cwd = resolve(input.cwd)
  try {
    if (!statSync(cwd).isDirectory()) throw new Error('Not a directory')
  } catch {
    throw new Error(`Choose an existing directory with --in: ${cwd}`)
  }
  const args = nativeArgs(input)
  if (flags.dryRun) {
    console.log(
      JSON.stringify(
        {
          runtime: input.runtime,
          model: input.model,
          effort: input.effort,
          cwd,
          prompt: input.prompt,
          args,
        },
        null,
        2,
      ),
    )
    return 0
  }
  if (flags.json || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      'Native launching needs a terminal. Use --dry-run --json to preview, or openrun run for managed execution.',
    )
  ui.info(
    `Opening ${NATIVE_RUNTIMES[input.runtime].label} · ${input.model || 'default model'} · ${input.effort || 'default effort'}`,
  )
  const code = await ui.handoff(async () => {
    discovery(input)
    const child = spawn(binary.path, args, { cwd, stdio: 'inherit', shell: false })
    // Terminal SIGINT reaches the whole foreground group. Let the child own it.
    const interrupt = () => {}
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    try {
      const code = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('spawn', () =>
          remember({ runtime: input.runtime, model: input.model, effort: input.effort }),
        )
        child.once('exit', (code, signal) =>
          resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)),
        )
      })
      discovery(input)
      return code
    } finally {
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', terminate)
    }
  })
  ui.info(`Returned from ${NATIVE_RUNTIMES[input.runtime].label} · exit ${code}`)
  return code
}
