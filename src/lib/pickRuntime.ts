/**
 * Shared default-runtime selection for new Automations, Planner, and chat
 * starters. Pure + dependency-free so browser forms and tests can share it.
 */

export type RuntimePickCandidate = {
  id: string
  /** False / missing means the binary is not known to be on PATH. */
  installed?: boolean
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
