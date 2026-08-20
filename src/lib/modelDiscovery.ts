/**
 * Turn what a CLI already knows about its own models into our `ModelOption`s.
 *
 * Every coding CLI ships or prints its model list somewhere; none of them agree
 * on a format. This module holds the per-CLI *parsers* — pure `text → models`
 * functions so `node:test` can cover them without a child process (`lib/` rule).
 * Reading the bundle / spawning the CLI lives in `server/modelCatalog.ts`.
 *
 * Anything here may fail to match: a CLI update can move the shape out from
 * under us. Parsers return `[]` on any doubt and the caller falls back to the
 * static catalog in `models.ts`, so a bad parse degrades to "slightly stale
 * list", never to an empty picker.
 */
import type { EffortOption, ModelOption, RuntimeModelKind } from './models.ts'

/** One model as the CLI describes it, before we shape it for the picker. */
export type DiscoveredModel = {
  slug: string
  name: string
  /** Effort values the CLI accepts for this model; empty = no `--effort`. */
  efforts: string[]
  defaultEffort: string
  /** Higher sorts first. Mirrors Claude's `advisor_rank`. */
  rank: number
  /** The CLI's own default. Sorts above everything, so it is what we preselect. */
  preferred?: boolean
}

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
  max: 'Max',
}

/** Prompt-injected pseudo-effort we add on top of whatever the CLI reports. */
const ULTRATHINK: EffortOption = {
  value: 'ultrathink',
  label: 'Ultrathink',
  promptInjected: true,
}

/** Ours, not the CLI's: Ultracode rides the highest real effort the model has. */
const ULTRACODE: EffortOption = { value: 'ultracode', label: 'Ultracode' }

/**
 * Composer trigger button is narrow, so drop the trailing qualifier —
 * "Claude Sonnet 4.6 (Thinking)" → "Claude Sonnet 4.6". Only when it stays
 * unambiguous: Antigravity distinguishes whole models by that qualifier
 * ("Gemini 3.7 Flash (High)" vs "(Low)"), and three identical entries in the
 * picker would be worse than three long ones.
 */
function shortNames(names: string[]): string[] {
  const trimmed = names.map((n) => n.replace(/\s*\([^)]*\)\s*$/, '').trim() || n)
  const counts = new Map<string, number>()
  for (const t of trimmed) counts.set(t, (counts.get(t) ?? 0) + 1)
  return trimmed.map((t, i) => ((counts.get(t) ?? 0) > 1 ? (names[i] as string) : t))
}

function effortOptions(m: DiscoveredModel, kind: RuntimeModelKind): EffortOption[] {
  if (m.efforts.length === 0) {
    // The CLI rejects --effort here, so Ultrathink is the only knob — and it
    // rewrites the prompt, so it must be opt-in rather than the default.
    return kind === 'claude' ? [ULTRATHINK] : []
  }
  const out: EffortOption[] = m.efforts.map((value) => ({
    value,
    label: EFFORT_LABELS[value] ?? value,
    isDefault: value === m.defaultEffort,
  }))
  if (!out.some((e) => e.isDefault) && out[0]) out[0].isDefault = true
  if (kind === 'claude') {
    if (m.efforts.includes('xhigh')) out.push(ULTRACODE)
    out.push(ULTRATHINK)
  }
  return out
}

/**
 * Compare two model ids by their embedded version, newest first, so
 * `opus-5` outranks `opus-4-8` outranks `opus-4-7` regardless of bundle order.
 */
function byVersionDesc(a: string, b: string): number {
  const nums = (s: string) => Array.from(s.matchAll(/\d+/g), (m) => Number(m[0]))
  const an = nums(a)
  const bn = nums(b)
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const d = (bn[i] ?? -1) - (an[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

/**
 * Shape discovered models into picker options.
 *
 * Order is the contract here: `defaultModel()` takes the first entry, so the
 * CLI's own default has to lead, then the most capable, then newest within a
 * capability tier.
 */
export function catalogFromDiscovered(
  kind: RuntimeModelKind,
  models: DiscoveredModel[],
): ModelOption[] {
  const seen = new Set<string>()
  const ordered = models
    .filter((m) => {
      if (!m.slug || seen.has(m.slug)) return false
      seen.add(m.slug)
      return true
    })
    .sort(
      (a, b) =>
        Number(b.preferred ?? false) - Number(a.preferred ?? false) ||
        b.rank - a.rank ||
        byVersionDesc(a.slug, b.slug),
    )
  const short = shortNames(ordered.map((m) => m.name))
  return ordered.map((m, i) => ({
    slug: m.slug,
    name: m.name,
    shortName: short[i] as string,
    efforts: effortOptions(m, kind),
    provider: kind,
  }))
}

// --- Claude Code -----------------------------------------------------------

/**
 * Claude Code has no `models list` command — the catalog is baked into the
 * shipped bundle as a JS object literal. We scan for entries rather than
 * parsing JS: `{id:"claude-…",family:"…",display_name:"…"` followed within the
 * same entry by `capabilities:[…]` and `default_effort:"…"`.
 *
 * We keep only what a Claude Code *run* can actually select today: the latest
 * model per family (from `latest_per_family`) plus anything that still accepts
 * `--effort`. Historical ids stay in the bundle forever and would bury the
 * picker.
 */
export function parseClaudeBundleModels(text: string): DiscoveredModel[] {
  const entry = /\{id:"(claude-[a-z0-9.-]+)",family:"([a-z0-9]+)",display_name:"([^"]+)"/g
  const found: DiscoveredModel[] = []

  for (let m = entry.exec(text); m; m = entry.exec(text)) {
    const [, slug, , name] = m
    if (!slug || !name) continue
    // Metadata for one model stays well inside this window; a larger one risks
    // reading the *next* entry's capabilities.
    const window = text.slice(m.index, m.index + 2400)
    const caps = /capabilities:\[([^\]]*)\]/.exec(window)?.[1] ?? ''
    const defaultEffort = /default_effort:"([a-z]+)"/.exec(window)?.[1] ?? ''
    const rank = Number(/advisor_rank:(\d+)/.exec(window)?.[1] ?? '0')

    const efforts: string[] = []
    if (caps.includes('"effort"')) {
      efforts.push('low', 'medium', 'high')
      if (caps.includes('"xhigh_effort"')) efforts.push('xhigh')
      if (caps.includes('"max_effort"')) efforts.push('max')
    }
    found.push({ slug, name, efforts, defaultEffort, rank })
  }
  if (found.length === 0) return []

  const latest = new Set(
    Array.from(
      (/latest_per_family:\{([^}]*)\}/.exec(text)?.[1] ?? '').matchAll(/"([a-z0-9-]+)"/g),
      (m) => m[1] as string,
    ),
  )
  // `claude` with no `--model` resolves the `opus` alias, so that is the model
  // a run gets today and the one the picker should open on.
  const preferred = /aliases:\{opus:\{default:"([a-z0-9-]+)"/.exec(text)?.[1] ?? ''
  for (const m of found) if (m.slug === preferred) m.preferred = true

  const keep = found.filter((m) => m.efforts.length > 0 || latest.has(m.slug))
  return keep.length > 0 ? keep : found
}

// --- Antigravity (`agy models`) -------------------------------------------

/**
 * `agy models` prints `<id>\t<Display Name>` per line after a status header.
 * Effort is a separate `--effort low|medium|high` flag that every model takes,
 * except the ids that already bake the effort in (`…-high`, `…-low`), which we
 * leave alone so we never send both.
 */
export function parseAgyModelsOutput(text: string): DiscoveredModel[] {
  const out: DiscoveredModel[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const parts = (lines[i] ?? '').split('\t')
    if (parts.length < 2) continue
    const slug = parts[0]?.trim() ?? ''
    const name = parts[1]?.trim() ?? ''
    if (!slug || !name || slug.includes(' ')) continue
    const bakedEffort = /-(low|medium|high)$/.test(slug)
    out.push({
      slug,
      name,
      efforts: bakedEffort ? [] : ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      // `agy models` prints most-capable first; keep that order.
      rank: lines.length - i,
    })
  }
  return out
}

// --- Grok (`grok models`) --------------------------------------------------

/**
 * `grok models` prints a bulleted list, marking one `(default)`. It runs (and
 * lists) even when logged out, so discovery works before the user authenticates.
 */
export function parseGrokModelsOutput(text: string): DiscoveredModel[] {
  const out: DiscoveredModel[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[*-]\s+([A-Za-z0-9][\w.-]*)\s*(\(default\))?\s*$/.exec(lines[i] ?? '')
    if (!m) continue
    const slug = m[1] as string
    out.push({
      slug,
      name: grokDisplayName(slug),
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
      rank: lines.length - i,
      preferred: Boolean(m[2]),
    })
  }
  return out
}

function grokDisplayName(slug: string): string {
  return slug.replace(/^grok-/, 'Grok ')
}
