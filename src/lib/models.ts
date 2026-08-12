/**
 * Model + effort catalogs per runtime kind.
 *
 * Mirrors the t3code composer controls (model picker + reasoning/thinking),
 * scoped to the CLIs Open Run actually drives. Values map to CLI flags in
 * `server/resume.ts` (`claude --model/--effort`, `codex -m` +
 * `model_reasoning_effort`, `grok -m` + `--reasoning-effort`).
 */

export type RuntimeModelKind = 'claude' | 'codex' | 'grok' | 'gemini' | 'generic'

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

const GROK_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium', isDefault: true },
  { value: 'high', label: 'High' },
]

export const CLAUDE_MODELS: ModelOption[] = [
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
    slug: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    shortName: 'Haiku 4.5',
    efforts: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium', isDefault: true },
      { value: 'high', label: 'High' },
    ],
    provider: 'claude',
  },
]

export const CODEX_MODELS: ModelOption[] = [
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

/** Map a runtime binary name to the model catalog kind. */
export function modelKindForBin(bin: string): RuntimeModelKind {
  const name = bin.split(/[\\/]/).pop() ?? bin
  if (name.includes('claude')) return 'claude'
  if (name.includes('codex')) return 'codex'
  if (name.includes('grok')) return 'grok'
  if (name.includes('gemini')) return 'gemini'
  return 'generic'
}

export function modelsForKind(kind: RuntimeModelKind): ModelOption[] {
  if (kind === 'claude') return CLAUDE_MODELS
  if (kind === 'codex') return CODEX_MODELS
  if (kind === 'grok') return GROK_MODELS
  if (kind === 'gemini') return GEMINI_MODELS
  return []
}

export function modelsForBin(bin: string): ModelOption[] {
  return modelsForKind(modelKindForBin(bin))
}

export function findModel(models: ModelOption[], slug: string | null | undefined): ModelOption | undefined {
  if (!slug) return undefined
  return models.find((m) => m.slug === slug)
}

export function defaultModel(models: ModelOption[]): ModelOption | undefined {
  return models[0]
}

export function defaultEffort(model: ModelOption | undefined): string {
  if (!model) return ''
  const def = model.efforts.find((e) => e.isDefault) ?? model.efforts[0]
  return def?.value ?? ''
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
export function applyPromptEffort(prompt: string, effort: string, opts?: { isFollowUp?: boolean }): string {
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
