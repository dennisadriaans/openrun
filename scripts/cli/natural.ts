import { resolveCloudUrl } from '../../src/lib/cloud/url.ts'
import {
  deriveTaskName,
  parseCliSchedule,
  type CliIntent,
  type CliSchedule,
} from '../../src/lib/cliSchedule.ts'
import { commandLineTokens, splitCommandLine } from './args.ts'
import { modelsForKind } from '../../src/lib/models.ts'

import {
  NATIVE_RUNTIMES,
  isNativeRuntime,
  matchNativeModel,
  resolveNativeEffort,
  resolveNativeRuntime,
  type NativeCatalog,
  type NativeRuntime,
  type InterpreterModel,
  type LaunchPreference,
} from './agentSelection.ts'
export { resolveNativeModel } from './agentSelection.ts'
export type {
  NativeCatalog,
  NativeRuntime,
  InterpreterModel,
  LaunchPreference,
} from './agentSelection.ts'

export const INTERPRETED_ACTIONS = [
  'launch',
  'schedule',
  'runs',
  'ls',
  'projects',
  'runtimes',
  'integrations',
  'worker',
  'resume',
  'init',
  'help',
] as const
export type InterpretedAction = (typeof INTERPRETED_ACTIONS)[number]
export type InterpretedIntent = {
  action: InterpretedAction
  intent: CliIntent
  clarify: string[]
  scheduleText?: string
}

const AGENT_LEADS = new Set(['using', 'use', 'with', 'for'])
type AgentControls = {
  runtime?: NativeRuntime
  model?: string
  effort?: string
  end: number
}

/** Read adjacent controls in any order, stopping at task text or a quoted token. */
function readAgentSelection(words: string[], start: number, catalogs: NativeCatalog[]) {
  const result: AgentControls = { end: start }
  const models = catalogs.flatMap((row) => row.models)
  while (result.end < words.length) {
    let index = result.end
    const lead = words[index]?.toLowerCase() ?? ''
    if (AGENT_LEADS.has(lead) || lead === 'at') index++
    const label = words[index]?.toLowerCase()
    if (['runtime', 'agent', 'model', 'reasoning', 'effort'].includes(label ?? '')) {
      index++
      if (label === 'reasoning' && words[index]?.toLowerCase() === 'effort') index++
    }
    let matched: AgentControls | undefined
    const modelCatalogs = result.runtime
      ? catalogs.filter((row) => row.runtime === result.runtime)
      : catalogs
    // Keep the longest name, so "Claude Sonnet 5" is one model control.
    for (let end = index + 1; end <= words.length; end++) {
      if (!words[end - 1]) break
      const hint = words.slice(index, end).join(' ')
      const runtime = result.runtime === undefined ? resolveNativeRuntime(hint) : undefined
      const model = result.model === undefined ? matchNativeModel(hint, modelCatalogs) : undefined
      const effort = result.effort === undefined ? resolveNativeEffort(hint, models) : undefined
      if (runtime && !['model', 'effort', 'reasoning'].includes(label ?? '')) {
        matched = { runtime, end }
      } else if (model && !['runtime', 'agent', 'effort', 'reasoning'].includes(label ?? '')) {
        matched = { model: hint, end }
      } else if (effort !== undefined && !['runtime', 'agent', 'model'].includes(label ?? '')) {
        matched = { effort, end }
      }
    }
    if (!matched) break
    Object.assign(result, matched)
    if (matched.effort !== undefined) {
      if (words[result.end]?.toLowerCase() === 'reasoning') result.end++
      if (words[result.end]?.toLowerCase() === 'effort') result.end++
    }
  }
  return result.end > start ? result : undefined
}

/** Keep recognized agent controls even when other parts need interpretation. */
export function parseLocalAgent(argv: readonly string[], catalogs: NativeCatalog[]) {
  const source = argv.length === 1 ? argv[0]! : undefined
  const tokens = source === undefined ? undefined : commandLineTokens(source)
  const words = tokens ? tokens.map((token) => token.value) : [...argv]
  const controls = words.map((word, index) =>
    tokens &&
    source !== undefined &&
    source.slice(tokens[index]!.start, tokens[index]!.end) !== word
      ? ''
      : word,
  )
  const groups: (AgentControls & { start: number; explicit: boolean })[] = []
  for (let index = 0; index < words.length; ) {
    const candidate = readAgentSelection(controls, index, catalogs)
    if (!candidate) {
      index++
      continue
    }
    groups.push({
      ...candidate,
      start: index,
      explicit:
        AGENT_LEADS.has(controls[index]!.toLowerCase()) ||
        /^(runtime|agent|model|effort|reasoning)$/i.test(controls[index]!),
    })
    index = candidate.end
  }
  const anchored = groups.filter((group) => {
    const fields = [group.runtime, group.model, group.effort].filter((value) => value !== undefined)
    return (
      (group.runtime || group.model) &&
      (group.explicit ||
        group.start === 0 ||
        fields.length > 1 ||
        (group.runtime && group.end === words.length))
    )
  })
  // A bare "sonnet" or "low" in prose is not a control. Once an agent is
  // named, controls at either end can complete it: "low <task> claude sonnet".
  const chosen = anchored.length
    ? groups.filter(
        (group) =>
          anchored.includes(group) ||
          group.explicit ||
          group.start === 0 ||
          group.end === words.length,
      )
    : []
  const runtimes = [...new Set(chosen.flatMap((group) => (group.runtime ? [group.runtime] : [])))]
  const modelHints = [...new Set(chosen.flatMap((group) => (group.model ? [group.model] : [])))]
  const efforts = [
    ...new Set(chosen.flatMap((group) => (group.effort !== undefined ? [group.effort] : []))),
  ]
  const runtime = runtimes[0]
  const model = modelHints[0]
    ? matchNativeModel(
        modelHints[0],
        runtime ? catalogs.filter((row) => row.runtime === runtime) : catalogs,
      )
    : undefined
  const selectedRuntime = runtime ?? model?.runtime
  const selection =
    selectedRuntime &&
    runtimes.length <= 1 &&
    modelHints.length <= 1 &&
    efforts.length <= 1 &&
    (!modelHints.length || model)
      ? {
          runtime: selectedRuntime,
          model: model?.model.slug ?? '',
          effort: efforts[0] ?? '',
          hasRuntime: runtime !== undefined,
          hasEffort: efforts.length > 0,
        }
      : undefined
  const removed = new Set<number>()
  if (selection)
    for (const group of chosen)
      for (let index = group.start; index < group.end; index++) removed.add(index)
  const remaining = words.filter((_word, index) => !removed.has(index))
  let prompt = remaining.join(' ')
  if (source !== undefined && tokens) {
    // Preserve literal quotes, escapes and spaces between untouched task words.
    const parts: string[] = []
    let start = 0
    for (const group of selection ? chosen : []) {
      parts.push(source.slice(start, tokens[group.start]!.start).trim())
      start = tokens[group.end - 1]!.end
    }
    parts.push(source.slice(start).trim())
    prompt = remaining.length === 1 ? remaining[0]! : parts.filter(Boolean).join(' ')
  }
  return { words: remaining, selection, prompt }
}

// Only clearly stated work takes the local shortcut. Management requests and
// ambiguous timing instructions still need the interpreter to choose an action.
const TASK_START =
  /^(?:please\s+)?(?:create|write|make|build|fix|review|inspect|explain|analyse|analyze|summarise|summarize|refactor|implement|add|update|remove|delete|rename|move|test|debug|check|new\s+file)\b/i
const TIMING =
  /\b(?:schedule|later|tomorrow|tonight|today|every|daily|hourly|weekly|next|after|before|at)\b|\bin\s+\d|\bfrom\s+now\b/i
const DELAY_START =
  /^(?:in|after)\s+(?:\d+|an?|one|two|three|four|five|ten|half(?:\s+an?)?)\s+(?:seconds?|secs?|minutes?|minuts?|mins?|hours?|hrs?|days?|weeks?|months?|[smhd])\b/i
const TIME_START =
  /^(?:at\s+\d|tomorrow\b|tonight\b|today\b|every\s+(?:(?:\d+|other)\s+)?(?:seconds?|minutes?|hours?|days?|weekdays?|weekends?|weeks?|months?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|daily\b|hourly\b|weekly\b|later\b|next\s+(?:week|weekend|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d+\s+(?:seconds?|secs?|minutes?|minuts?|mins?|hours?|hrs?)\s+from\s+now\b)/i

function startsTiming(text: string): boolean {
  return DELAY_START.test(text) || TIME_START.test(text)
}

/** Timing chooses task execution; quoted task contents are never controls. */
export function requestAction(
  text: string,
  mode: 'auto' | 'schedule' = 'auto',
): 'launch' | 'schedule' | undefined {
  if (mode === 'schedule') return 'schedule'
  const tokens = commandLineTokens(text)
  const plain = tokens.filter((token) => text.slice(token.start, token.end) === token.value)
  const timed = plain.some((token) => startsTiming(text.slice(token.start)))
  const immediate = tokens.some(
    (token, index) =>
      text.slice(token.start, token.end) === token.value &&
      /^(?:now|immediately)$/i.test(token.value) &&
      tokens[index - 1]?.value.toLowerCase() !== 'from',
  )
  if (timed && immediate) return undefined
  return timed ? 'schedule' : 'launch'
}

/** Recognize a new request in a form without interpreting ordinary field values. */
export function isImplicitRequest(text: string): boolean {
  const task = text.replace(/^(?:can|could|would|will)\s+you\s+/i, '')
  const start = TASK_START.exec(task)
  if (start && task.slice(start[0].length).trim()) return true
  try {
    const catalogs: NativeCatalog[] = (Object.keys(NATIVE_RUNTIMES) as NativeRuntime[]).map(
      (runtime) => ({ runtime, models: modelsForKind(runtime) }),
    )
    const request =
      parseLocalRequest([text], catalogs, 'auto') || parseLocalRequest([text], catalogs, 'schedule')
    return Boolean(request && (request.intent.prompt || /\s/.test(text.trim())))
  } catch {
    return false
  }
}

/** Keep task text intact while accepting execution times before or after it. */
function scheduledTask(text: string, words: readonly string[], now: Date) {
  if (words.length === 1 && /\s/.test(words[0]!)) return undefined
  let tokens: ReturnType<typeof commandLineTokens>
  try {
    if (requestAction(text) !== 'schedule') return undefined
    tokens = commandLineTokens(text)
  } catch {
    return undefined
  }
  const task = (value: string) => {
    const trimmed = value
      .trim()
      .replace(/\s+(?:do|run|schedule)\s+(?:it|this)$/i, '')
      .trim()
    const parts = commandLineTokens(trimmed)
    return parts.length === 1 ? parts[0]!.value : trimmed
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (
      text.slice(token.start, token.end) !== token.value ||
      !startsTiming(text.slice(token.start))
    )
      continue
    if (index > 0) {
      const prompt = task(text.slice(0, token.start))
      if (!TASK_START.test(prompt)) continue
      const scheduleText = text.slice(token.start).trim()
      try {
        return { prompt, schedule: scheduleFromText(scheduleText, now), scheduleText }
      } catch {}
    } else {
      for (let end = 1; end < tokens.length; end++) {
        const prompt = task(text.slice(tokens[end]!.start))
        if (!TASK_START.test(prompt)) continue
        const scheduleText = text.slice(0, tokens[end]!.start).trim()
        try {
          return { prompt, schedule: scheduleFromText(scheduleText, now), scheduleText }
        } catch {}
      }
    }
  }
}

/** Complete tasks with model/effort controls and common schedules resolve locally. */
export function parseLocalRequest(
  argv: readonly string[],
  catalogs: NativeCatalog[],
  mode: 'auto' | 'schedule',
  now = new Date(),
): InterpretedIntent | undefined {
  const { words: remaining, selection, prompt } = parseLocalAgent(argv, catalogs)
  if (
    mode === 'schedule' &&
    ['a', 'an', 'the'].includes(remaining[0]?.toLowerCase() ?? '') &&
    ['run', 'task', 'automation'].includes(remaining[1]?.toLowerCase() ?? '')
  )
    remaining.splice(0, 2)
  const scheduled = scheduledTask(prompt, remaining, now)
  const parsed = parseCliSchedule(
    scheduled ? [scheduled.prompt] : mode === 'schedule' ? remaining : [],
    now,
    { allowEmptyPrompt: true },
  )
  if (!parsed.ok) return undefined
  const { intent } = parsed
  if (mode === 'schedule') {
    if (!scheduled && (intent.schedule.kind === 'now' || !intent.prompt || intent.runtimeHint))
      return undefined
  } else {
    if (!selection) return undefined
    if (remaining.length) {
      if (
        (!scheduled && !TASK_START.test(prompt)) ||
        (!scheduled && TIMING.test(remaining.filter((word) => !/\s/.test(word)).join(' ')))
      )
        return undefined
      intent.prompt = prompt
    }
  }
  if (scheduled) {
    intent.prompt = scheduled.prompt
    intent.schedule = scheduled.schedule
  }
  if (selection) {
    intent.runtimeHint = selection.runtime
    intent.modelHint = selection.model
    intent.effortHint = selection.effort
  }
  intent.name = deriveTaskName(intent.prompt)
  return {
    action: mode === 'schedule' || scheduled ? 'schedule' : 'launch',
    intent,
    clarify: [],
    scheduleText: scheduled?.scheduleText,
  }
}

export function scheduleFromText(text: string, now = new Date()): CliSchedule {
  const relative = text
    .trim()
    .replace(/[.,]$/, '')
    .replace(/\bminuts?\b/gi, 'minutes')
    .replace(
      /^(?:at\s+)?(\d+)\s+(seconds?|secs?|minutes?|mins?|hours?|hrs?)\s+from\s+now$/i,
      'in $1 $2',
    )
    .replace(/^(in\s+\d+\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?))\s+from\s+now$/i, '$1')
    .replace(/^after\b/i, 'in')
  const words = splitCommandLine(relative)
  const parsed = parseCliSchedule(words, now, { allowEmptyPrompt: true })
  if (!parsed.ok) throw new Error(parsed.error)
  const { intent } = parsed
  if (intent.schedule.kind === 'now' || intent.prompt || intent.runtimeHint || intent.workspaceHint)
    throw new Error('Use a time such as “in 10 minutes”, “tomorrow at 9”, or “every weekday at 9”.')
  return intent.schedule
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The interpreter returned an invalid result. Use explicit launch options.')
  return value as Record<string, unknown>
}

/** The service can select only verbatim text from the user's request. */
export function textFromSpan(text: string, value: unknown): string {
  if (value === null) return ''
  const { start, end } = record(value)
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  )
    throw new Error('The interpreter returned invalid text boundaries.')
  let selected = text.slice(start, end).trim()
  if (
    (selected.startsWith('"') && selected.endsWith('"')) ||
    (selected.startsWith("'") && selected.endsWith("'"))
  )
    selected = selected.slice(1, -1)
  return selected
}

export function readInterpretation(
  value: unknown,
  text: string,
  mode: 'auto' | 'schedule',
): InterpretedIntent {
  const result = record(value)
  if (
    result.version !== 1 ||
    ![...INTERPRETED_ACTIONS, 'unsupported'].includes(String(result.action)) ||
    (result.runtime !== '' && !isNativeRuntime(result.runtime)) ||
    typeof result.model !== 'string' ||
    result.model.length > 160 ||
    typeof result.effort !== 'string' ||
    result.effort.length > 40 ||
    typeof result.openPr !== 'boolean' ||
    !Array.isArray(result.clarify) ||
    !result.clarify.every((field) =>
      ['action', 'model', 'effort', 'prompt', 'schedule'].includes(field),
    )
  )
    throw new Error('The interpreter returned an invalid result. Use explicit launch options.')
  let clarify: string[] = [...result.clarify]
  if (result.action === 'unsupported') clarify.push('action')
  let action: InterpretedAction =
    mode === 'schedule'
      ? 'schedule'
      : result.action === 'unsupported'
        ? 'launch'
        : (result.action as InterpretedAction)
  const prompt = textFromSpan(text, result.prompt)
  const scheduleText = textFromSpan(text, result.schedule)
  if (action === 'launch' || action === 'schedule') {
    const inferred = requestAction(text, mode)
    if (inferred && result.action !== 'unsupported') {
      action = scheduleText ? 'schedule' : inferred
      clarify = clarify.filter((field) => field !== 'action')
    } else clarify.push('action')
  }
  if (result.prompt && result.schedule) {
    const promptSpan = record(result.prompt)
    const scheduleSpan = record(result.schedule)
    if (
      Number(promptSpan.start) < Number(scheduleSpan.end) &&
      Number(scheduleSpan.start) < Number(promptSpan.end)
    )
      clarify.push('prompt', 'schedule')
  }
  let schedule: CliSchedule = { kind: 'now' }
  if (action === 'schedule') {
    try {
      schedule = scheduleFromText(scheduleText)
    } catch {
      clarify.push('schedule')
    }
    if (!prompt) clarify.push('prompt')
  }
  return {
    action,
    intent: {
      prompt,
      schedule,
      runtimeHint: String(result.runtime),
      modelHint: result.model,
      effortHint: result.effort,
      workspaceHint: '',
      name: deriveTaskName(prompt),
      openPr: result.openPr,
    },
    clarify: [...new Set(clarify)],
    scheduleText,
  }
}

// Keep the displayed interpretation for Enter. Re-read source spans on reuse so
// relative times start at submission, not when the user paused while typing.
let recentInterpretation: { key: string; value: unknown; expires: number } | undefined

export async function interpretRequest(
  text: string,
  models: InterpreterModel[],
  mode: 'auto' | 'schedule',
  preferred?: LaunchPreference,
  signal?: AbortSignal,
): Promise<InterpretedIntent> {
  signal?.throwIfAborted()
  if (text.length > 4000 || text.trim().split(/\s+/).length > 200)
    throw new Error(
      'Keep the request under 200 words and 4,000 characters. Use --prompt for longer tasks.',
    )
  const base = resolveCloudUrl(process.env.OPENRUN_CLOUD_URL ?? process.env.AGENTOPS_CLOUD_URL)
  if (!base) throw new Error('Hosted interpretation is disabled. Use explicit launch options.')
  const body = JSON.stringify({ version: 1, text, models, mode, preferred })
  const key = `${base}\n${body}`
  if (recentInterpretation?.key === key && recentInterpretation.expires > Date.now())
    return readInterpretation(recentInterpretation.value, text, mode)
  let response: Response
  try {
    response = await fetch(`${base}/api/cli/interpret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      redirect: 'error',
    })
  } catch {
    signal?.throwIfAborted()
    throw new Error(
      'Could not reach hosted interpretation. Try again, or use explicit launch options.',
    )
  }
  if (!response.ok) {
    const reason =
      response.status === 429
        ? 'Hosted interpretation is busy. Try again in a minute, or choose options locally.'
        : response.status === 400
          ? 'Hosted interpretation rejected this request (HTTP 400). Choose options locally or use explicit flags.'
          : `Hosted interpretation failed (HTTP ${response.status}). Choose options locally or use explicit flags.`
    throw new Error(reason)
  }
  const value: unknown = await response.json()
  signal?.throwIfAborted()
  const interpreted = readInterpretation(value, text, mode)
  recentInterpretation = { key, value, expires: Date.now() + 60_000 }
  return interpreted
}
