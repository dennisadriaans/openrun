/**
 * Model + effort catalogs per runtime kind.
 *
 * Mirrors the t3code composer controls (model picker + reasoning/thinking),
 * scoped to the CLIs Open Run actually drives. Values map to CLI flags in
 * `server/resume.ts` (`claude --model/--effort`, `codex -m` +
 * `model_reasoning_effort`, `grok -m` + `--reasoning-effort`,
 * `agy --model/--effort`, `fx acp --model` / `FX_MODEL`).
 *
 * **These lists are a fallback, not the source of truth.** At runtime
 * `server/modelCatalog.ts` reads the models the *installed* CLI actually knows
 * about and caches them, so a `claude` update lands in the picker without a
 * release here. What follows is what a fresh clone sees before that first
 * discovery finishes, and what a CLI we cannot introspect keeps using — keep it
 * roughly current, but do not treat it as authoritative.
 */

export type RuntimeModelKind =
  | 'claude'
  | 'codex'
  | 'grok'
  | 'gemini'
  | 'antigravity'
  | 'fx'
  | 'generic'

export type EffortOption = {
  value: string
  label: string
  /** When true, effort is injected into the prompt instead of a CLI flag. */
  promptInjected?: boolean
  isDefault?: boolean
}

export type ModelOption = {
  slug: string
  name: string
  /** Short label for the composer trigger button. */
  shortName: string
  efforts: EffortOption[]
  /** Provider brand for the model picker icon. */
  provider: RuntimeModelKind
}

const CLAUDE_EFFORTS_OPUS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', isDefault: true },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
  { value: 'ultracode', label: 'Ultracode' },
  { value: 'ultrathink', label: 'Ultrathink', promptInjected: true },
]

const CLAUDE_EFFORTS_SONNET: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', isDefault: true },
  { value: 'max', label: 'Max' },
  { value: 'ultrathink', label: 'Ultrathink', promptInjected: true },
]

const CODEX_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', isDefault: true },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
]

const CODEX_EFFORTS_5_6: EffortOption[] = [
  ...CODEX_EFFORTS,
  { value: 'max', label: 'Max' },
  { value: 'ultra', label: 'Ultra' },
]

const GROK_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', isDefault: true },
  { value: 'high', label: 'High' },
]

export const CLAUDE_MODELS: ModelOption[] = [
  {
    slug: 'claude-opus-5',
    name: 'Claude Opus 5',
    shortName: 'Opus 5',
    efforts: CLAUDE_EFFORTS_OPUS,
    provider: 'claude',
  },
  {
    slug: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    shortName: 'Sonnet 5',
    efforts: CLAUDE_EFFORTS_OPUS,
    provider: 'claude',
  },
  {
    slug: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    shortName: 'Opus 4.8',
    efforts: CLAUDE_EFFORTS_OPUS,
    provider: 'claude',
  },
  {
    slug: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    efforts: CLAUDE_EFFORTS_SONNET,
    provider: 'claude',
  },
  {
    // No `effort` capability — passing `--effort` to Haiku is rejected, so the
    // only knob it gets is our prompt-injected one, and it must be opt-in.
    slug: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    efforts: [
      { value: '', label: 'Default', isDefault: true },
      { value: 'ultrathink', label: 'Ultrathink', promptInjected: true },
    ],
    provider: 'claude',
  },
]

export const CODEX_MODELS: ModelOption[] = [
  {
    slug: 'gpt-5.6-sol',
    name: 'GPT-5.6-Sol',
    shortName: 'Sol',
    efforts: CODEX_EFFORTS_5_6,
    provider: 'codex',
  },
  {
    slug: 'gpt-5.6-terra',
    name: 'GPT-5.6-Terra',
    shortName: 'Terra',
    efforts: CODEX_EFFORTS_5_6,
    provider: 'codex',
  },
  {
    slug: 'gpt-5.6-luna',
    name: 'GPT-5.6-Luna',
    shortName: 'Luna',
    // Luna tops out below Sol/Terra — no `ultra`.
    efforts: [...CODEX_EFFORTS, { value: 'max', label: 'Max' }],
    provider: 'codex',
  },
  {
    slug: 'gpt-5.5',
    name: 'GPT-5.5',
    shortName: 'GPT-5.5',
    efforts: CODEX_EFFORTS,
    provider: 'codex',
  },
  {
    slug: 'gpt-5.4',
    name: 'GPT-5.4',
    shortName: 'GPT-5.4',
    efforts: CODEX_EFFORTS,
    provider: 'codex',
  },
  {
    slug: 'gpt-5.2',
    name: 'GPT-5.2',
    shortName: 'GPT-5.2',
    efforts: CODEX_EFFORTS,
    provider: 'codex',
  },
  { slug: 'o3', name: 'o3', shortName: 'o3', efforts: CODEX_EFFORTS, provider: 'codex' },
  {
    slug: 'o4-mini',
    name: 'o4-mini',
    shortName: 'o4-mini',
    efforts: CODEX_EFFORTS,
    provider: 'codex',
  },
]

export const GROK_MODELS: ModelOption[] = [
  {
    slug: 'grok-4.6',
    name: 'Grok 4.6',
    shortName: 'Grok 4.6',
    efforts: GROK_EFFORTS,
    provider: 'grok',
  },
  {
    slug: 'grok-4.5',
    name: 'Grok 4.5',
    shortName: 'Grok 4.5',
    efforts: GROK_EFFORTS,
    provider: 'grok',
  },
]

const GEMINI_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', isDefault: true },
  { value: 'high', label: 'High' },
]

export const GEMINI_MODELS: ModelOption[] = [
  {
    slug: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    shortName: 'Gemini 3 Pro',
    efforts: GEMINI_EFFORTS,
    provider: 'gemini',
  },
  {
    slug: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    shortName: 'Gemini 3 Flash',
    efforts: GEMINI_EFFORTS,
    provider: 'gemini',
  },
]

const ANTIGRAVITY_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', isDefault: true },
  { value: 'high', label: 'High' },
]

/**
 * fx is model-agnostic via Vercel AI Gateway. The compiled default is
 * `zai/glm-5.2-fast`; discovery via `fx models --json` replaces this seed.
 */
export const FX_MODELS: ModelOption[] = [
  {
    slug: 'zai/glm-5.2-fast',
    name: 'GLM 5.2 Fast',
    shortName: 'GLM 5.2 Fast',
    efforts: [],
    provider: 'fx',
  },
  {
    slug: 'zai/glm-5.2',
    name: 'GLM 5.2',
    shortName: 'GLM 5.2',
    efforts: [],
    provider: 'fx',
  },
]

/**
 * Antigravity ships a long, account-dependent list and prints the real one via
 * `agy models`, so this seed is deliberately minimal — it only has to keep the
 * picker non-empty until the first discovery lands.
 */
export const ANTIGRAVITY_MODELS: ModelOption[] = [
  {
    slug: 'gemini-3.1-pro-high',
    name: 'Gemini 3.1 Pro (High)',
    shortName: 'Gemini 3.1 Pro',
    // Effort is baked into the id; `--effort` alongside it would double up.
    efforts: [],
    provider: 'antigravity',
  },
  {
    slug: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    shortName: 'Claude Sonnet 4.6',
    efforts: ANTIGRAVITY_EFFORTS,
    provider: 'antigravity',
  },
]

/** Map a runtime binary name to the model catalog kind. */
export function modelKindForBin(bin: string): RuntimeModelKind {
  const name = bin.split(/[\\/]/).pop() ?? bin
  if (name.includes('claude')) return 'claude'
  if (name.includes('codex')) return 'codex'
  if (name.includes('grok')) return 'grok'
  if (name.includes('gemini')) return 'gemini'
  // Antigravity's binary is `agy`; match the product name too for users who
  // pointed the runtime at an explicit path.
  if (name === 'agy' || name.includes('antigravity')) return 'antigravity'
  if (name === 'fx' || name === 'fx.exe') return 'fx'
  return 'generic'
}

export function modelsForKind(kind: RuntimeModelKind): ModelOption[] {
  if (kind === 'claude') return CLAUDE_MODELS
  if (kind === 'codex') return CODEX_MODELS
  if (kind === 'grok') return GROK_MODELS
  if (kind === 'gemini') return GEMINI_MODELS
  if (kind === 'antigravity') return ANTIGRAVITY_MODELS
  if (kind === 'fx') return FX_MODELS
  return []
}

export function modelsForBin(bin: string): ModelOption[] {
  return modelsForKind(modelKindForBin(bin))
}

/**
 * What a model picker should show for a runtime: the catalog the server
 * discovered from the installed binary, or the static seed when discovery has
 * not run (fresh clone, unsupported CLI, older cached row).
 */
export function modelsForRuntime(runtime: { bin: string; models?: ModelOption[] }): ModelOption[] {
  return runtime.models && runtime.models.length > 0 ? runtime.models : modelsForBin(runtime.bin)
}

/**
 * Apply the user's hidden-model list to a catalog.
 *
 * Hiding is presentation only — it never blocks a model. Two things always
 * survive it, because a picker that cannot show its own value or has nothing
 * to offer is broken rather than tidy:
 *
 * - `keepSlug` (what is selected right now), so an already-running
 *   conversation on a hidden model still shows what it is using.
 * - the whole catalog, if hiding would empty it.
 */
export function visibleModels(
  models: ModelOption[],
  hidden: readonly string[] | undefined,
  keepSlug?: string | null,
): ModelOption[] {
  if (!hidden || hidden.length === 0) return models
  const hide = new Set(hidden)
  const kept = models.filter((m) => !hide.has(m.slug) || m.slug === keepSlug)
  return kept.length > 0 ? kept : models
}

/**
 * The models a catalog is currently hiding, in catalog order — the complement
 * of {@link visibleModels}, so a hidden model that survived as `keepSlug` is
 * counted once, on the visible side.
 */
export function hiddenModelsIn(
  models: ModelOption[],
  hidden: readonly string[] | undefined,
  keepSlug?: string | null,
): ModelOption[] {
  const shown = new Set(visibleModels(models, hidden, keepSlug).map((m) => m.slug))
  return models.filter((m) => !shown.has(m.slug))
}

/** Flip one model between hidden and shown, returning the next hidden list. */
export function toggleHiddenModel(hidden: readonly string[] | undefined, slug: string): string[] {
  const list = hidden ?? []
  return list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]
}

export function findModel(
  models: ModelOption[],
  slug: string | null | undefined,
): ModelOption | undefined {
  if (!slug) return undefined
  return models.find((m) => m.slug === slug)
}

export function defaultModel(models: ModelOption[]): ModelOption | undefined {
  return models[0]
}

export function defaultEffort(model: ModelOption | undefined): string {
  if (!model) return ''
  const def = model.efforts.find((e) => e.isDefault) ?? model.efforts[0]
  // Never default into a prompt-injected level — rewriting the prompt is
  // always an explicit choice, never what a model falls back to.
  if (!def || def.promptInjected) return ''
  return def.value
}

export function effortLabel(model: ModelOption | undefined, effort: string): string {
  if (!model) return effort
  return model.efforts.find((e) => e.value === effort)?.label ?? effort
}

export function isPromptInjectedEffort(model: ModelOption | undefined, effort: string): boolean {
  return Boolean(model?.efforts.find((e) => e.value === effort)?.promptInjected)
}

/** Prefix used by Claude for Ultrathink (matches t3code). */
export const ULTRATHINK_PREFIX = 'Ultrathink:\n'

/** Apply Ultrathink prefix once (first turn). Follow-ups skip re-injection. */
export function applyPromptEffort(
  prompt: string,
  effort: string,
  opts?: { isFollowUp?: boolean },
): string {
  if (opts?.isFollowUp) return prompt
  if (effort !== 'ultrathink') return prompt
  if (/^ultrathink:\s*/i.test(prompt)) return prompt
  return `${ULTRATHINK_PREFIX}${prompt}`
}

/** CLI effort flag value, or null when effort is prompt-injected / unused. */
export function cliEffortValue(
  kind: RuntimeModelKind,
  model: ModelOption | undefined,
  effort: string,
): string | null {
  if (!effort) return null
  if (isPromptInjectedEffort(model, effort)) return null
  if (kind === 'claude' && effort === 'ultracode') return 'xhigh'
  return effort
}
