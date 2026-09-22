import {
  modelKindForBin,
  type ModelOption,
  type RuntimeModelKind,
} from '@openrun/domain/runtimes/models'

export const NATIVE_RUNTIMES = {
  codex: { bin: 'codex', label: 'Codex', aliases: ['codex', 'openai', 'codex cli'] },
  claude: { bin: 'claude', label: 'Claude Code', aliases: ['claude', 'claude code', 'anthropic'] },
  grok: { bin: 'grok', label: 'Grok', aliases: ['grok', 'grok build', 'xai'] },
  gemini: { bin: 'gemini', label: 'Gemini CLI', aliases: ['gemini', 'gemini cli'] },
  antigravity: { bin: 'agy', label: 'Antigravity', aliases: ['antigravity', 'agy'] },
  fx: { bin: 'fx', label: 'fx', aliases: ['fx'] },
} satisfies Partial<Record<RuntimeModelKind, { bin: string; label: string; aliases: string[] }>>

export type NativeRuntime = keyof typeof NATIVE_RUNTIMES
export type NativeCatalog = { runtime: NativeRuntime; models: ModelOption[] }
export type LaunchPreference = { runtime: NativeRuntime; model: string; effort: string }
export type InterpreterModel = {
  runtime: NativeRuntime
  slug: string
  name: string
  aliases: string[]
  efforts: string[]
  preferred: boolean
}

export function isNativeRuntime(value: unknown): value is NativeRuntime {
  return typeof value === 'string' && Object.hasOwn(NATIVE_RUNTIMES, value)
}

/** Spaces, hyphens and dotted versions are equivalent, without fuzzy matching. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bheiku\b/g, 'haiku')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolveNativeRuntime(hint: string): NativeRuntime | undefined {
  return (Object.keys(NATIVE_RUNTIMES) as NativeRuntime[]).find((runtime) =>
    NATIVE_RUNTIMES[runtime].aliases.some((alias) => normalize(alias) === normalize(hint)),
  )
}

function modelNames(model: ModelOption): string[] {
  const slug = model.slug.split('/').pop()!
  const names = [model.slug, slug, model.name, model.shortName]
  return [
    ...new Set(
      names.flatMap((name) => [normalize(name), normalize(name.replace(/^claude[- ]/i, ''))]),
    ),
  ]
}

/** Families are derived from ids, so a newly discovered model needs no new alias. */
export function modelAliases(model: ModelOption): string[] {
  const slug = model.slug.split('/').pop()!.toLowerCase()
  const family =
    /^claude-(?:[\d-]+-)?([a-z]+)(?:-|$)/.exec(slug)?.[1] ?? /^gpt-[\d.]+-(.+)$/.exec(slug)?.[1]
  return [...new Set([...modelNames(model), ...(family ? [normalize(family)] : [])])]
}

export function resolveNativeModel(hint: string, models: ModelOption[]): ModelOption | undefined {
  const needle = normalize(hint)
  if (!needle) return undefined
  const exact = models.filter((model) => modelNames(model).includes(needle))
  const matches = exact.length
    ? exact
    : models.filter((model) => modelAliases(model).includes(needle))
  return matches.sort((a, b) => b.slug.localeCompare(a.slug, undefined, { numeric: true }))[0]
}

/** Prefer the provider's CLI when a gateway exposes the same model too. */
export function matchNativeModel(hint: string, catalogs: NativeCatalog[]) {
  const matches = catalogs.flatMap(({ runtime, models }) => {
    const model = resolveNativeModel(hint, models)
    return model ? [{ runtime, model }] : []
  })
  if (matches.length === 1) return matches[0]
  const native = matches.filter(({ runtime, model }) => {
    const slug = model.slug.split('/').pop()!
    const provider = /^(?:gpt-|o\d(?:-|$))/.test(slug) ? 'codex' : modelKindForBin(slug)
    return provider === runtime
  })
  return native.length === 1 ? native[0] : undefined
}

const EFFORT_ALIASES: Record<string, string> = {
  'extra high': 'xhigh',
  'very high': 'xhigh',
  maximum: 'max',
  'ultra think': 'ultrathink',
  'ultra code': 'ultracode',
  default: '',
  auto: '',
}
const KNOWN_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'ultracode',
  'ultrathink',
]

/** Returns undefined for task prose; unsupported but known levels still get validated. */
export function resolveNativeEffort(hint: string, models: ModelOption[]): string | undefined {
  const needle = normalize(hint)
  if (Object.hasOwn(EFFORT_ALIASES, needle)) return EFFORT_ALIASES[needle]
  const option = models
    .flatMap((model) => model.efforts)
    .find((effort) => normalize(effort.value) === needle || normalize(effort.label) === needle)
  return option?.value ?? KNOWN_EFFORTS.find((effort) => effort === needle)
}

/** Keep named models even in large gateway catalogs; share remaining room across runtimes. */
export function interpreterModels(
  catalogs: NativeCatalog[],
  text: string,
  preferred?: LaunchPreference,
): InterpreterModel[] {
  const request = ` ${normalize(text)} `
  const queues = catalogs.map(({ runtime, models }) =>
    models.map((model, index) => ({
      runtime,
      slug: model.slug,
      name: model.name,
      aliases: modelAliases(model).slice(0, 12),
      efforts: model.efforts.map((effort) => effort.value),
      preferred: model.preferred === true || (index === 0 && !models.some((row) => row.preferred)),
    })),
  )
  const named = queues
    .flat()
    .filter(
      (model) =>
        model.aliases.some((alias) => request.includes(` ${alias} `)) ||
        (preferred?.runtime === model.runtime && preferred.model === model.slug),
    )
  const result: InterpreterModel[] = []
  const seen = new Set<string>()
  let bytes = 0
  const add = (model: InterpreterModel) => {
    const key = `${model.runtime}:${model.slug}`
    const size = new TextEncoder().encode(JSON.stringify(model)).length + 1
    // Leave room for 4,000 characters of request text and remembered settings.
    if (seen.has(key) || result.length >= 60 || bytes + size > 16_000) return
    seen.add(key)
    bytes += size
    result.push(model)
  }
  named.forEach(add)
  for (let index = 0; queues.some((queue) => index < queue.length); index++)
    for (const queue of queues) if (queue[index]) add(queue[index]!)
  return result
}
