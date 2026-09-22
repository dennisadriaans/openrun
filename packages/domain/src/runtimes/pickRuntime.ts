/**
 * Shared default-runtime selection for new Automations, Planner, and chat
 * starters. Pure + dependency-free so browser forms and tests can share it.
 *
 * Hiding a runtime is presentation only — same contract as hidden models.
 */

export type RuntimePickCandidate = {
  id: string
  /** False / missing means the binary is not known to be on PATH. */
  installed?: boolean
}

/**
 * Apply the user's hidden-runtime list to a catalog.
 *
 * Hiding never blocks a runtime. Two things always survive it:
 *
 * - `keepId` (what is selected right now), so a picker can still name its value.
 * - the whole catalog, if hiding would empty it.
 */
export function visibleRuntimes<T extends { id: string }>(
  runtimes: readonly T[],
  hidden: readonly string[] | undefined,
  keepId?: string | null,
): T[] {
  if (!hidden || hidden.length === 0) return [...runtimes]
  const hide = new Set(hidden)
  const kept = runtimes.filter((r) => !hide.has(r.id) || r.id === keepId)
  return kept.length > 0 ? kept : [...runtimes]
}

/**
 * Runtimes currently hidden, in catalog order. A hidden runtime that survived
 * as `keepId` is counted once, on the visible side.
 */
export function hiddenRuntimesIn<T extends { id: string }>(
  runtimes: readonly T[],
  hidden: readonly string[] | undefined,
  keepId?: string | null,
): T[] {
  const shown = new Set(visibleRuntimes(runtimes, hidden, keepId).map((r) => r.id))
  return runtimes.filter((r) => !shown.has(r.id))
}

/** Flip one runtime between hidden and shown, returning the next hidden list. */
export function toggleHiddenRuntime(hidden: readonly string[] | undefined, id: string): string[] {
  const list = hidden ?? []
  return list.includes(id) ? list.filter((s) => s !== id) : [...list, id]
}

/**
 * Prefer the last-used runtime when it still exists, then any installed binary,
 * then the first row. Returns undefined when the list is empty.
 */
export function pickDefaultRuntime<T extends RuntimePickCandidate>(
  runtimes: readonly T[],
  preferredId?: string | null,
): T | undefined {
  if (runtimes.length === 0) return undefined
  const preferred = preferredId?.trim()
  if (preferred) {
    const remembered = runtimes.find((r) => r.id === preferred)
    if (remembered) return remembered
  }
  return runtimes.find((r) => r.installed) ?? runtimes[0]
}

/** Convenience: just the id, or undefined when there is nothing to pick. */
export function pickDefaultRuntimeId(
  runtimes: readonly RuntimePickCandidate[],
  preferredId?: string | null,
): string | undefined {
  return pickDefaultRuntime(runtimes, preferredId)?.id
}

/**
 * Drop runtimes whose binary is not on PATH. Same escape hatches as
 * `visibleRuntimes`: `keepId` always survives, and an empty result falls back
 * to the whole catalog (nothing installed yet — still let the user pick).
 */
export function installedRuntimes<T extends RuntimePickCandidate>(
  runtimes: readonly T[],
  keepId?: string | null,
): T[] {
  const kept = runtimes.filter((r) => r.installed || r.id === keepId)
  return kept.length > 0 ? kept : [...runtimes]
}
