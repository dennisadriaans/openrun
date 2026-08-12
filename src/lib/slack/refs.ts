/**
 * Turning "#2" or "nightly docs" into an id (browser-safe).
 *
 * Typing `run_ma1b2c3d` on a phone is a non-starter, so every list Open Run
 * posts to Slack is numbered and those numbers are addressable. Resolution is
 * pure so it can be tested without a database — the server hands in the rows it
 * already listed.
 *
 * Ambiguity is reported, never guessed: picking the wrong automation would
 * start the wrong agent against the wrong repo.
 */

export type RunCandidate = {
  id: string
  /** 1-based position in the list that was posted to Slack. */
  ordinal: number
  taskName?: string
  status?: string
}

export type TaskCandidate = {
  id: string
  name: string
}

export type ResolveResult<T> = { ok: true; value: T } | { ok: false; reason: string }

const LATEST_WORDS = new Set(['last', 'latest', 'current', 'it', 'this'])

/**
 * Resolve a run reference against the runs most recently listed.
 *
 * Accepts `#2`, `2`, a full `run_…` id, an unambiguous id prefix, `last`, or a
 * substring of the automation name.
 */
export function resolveRunRef(
  ref: string,
  candidates: readonly RunCandidate[],
): ResolveResult<string> {
  const raw = ref.trim()
  if (!raw) return { ok: false, reason: 'Which run? Try `runs` to list them.' }
  if (candidates.length === 0) {
    return { ok: false, reason: 'There are no runs to point at yet.' }
  }

  const lower = raw.toLowerCase()

  if (LATEST_WORDS.has(lower)) {
    const newest = [...candidates].sort((a, b) => a.ordinal - b.ordinal)[0]
    return { ok: true, value: newest.id }
  }

  const ordinalMatch = /^#?(\d{1,3})$/.exec(raw)
  if (ordinalMatch) {
    const wanted = Number(ordinalMatch[1])
    const hit = candidates.find((c) => c.ordinal === wanted)
    return hit
      ? { ok: true, value: hit.id }
      : { ok: false, reason: `There is no run #${wanted} in the last list.` }
  }

  const exact = candidates.find((c) => c.id.toLowerCase() === lower)
  if (exact) return { ok: true, value: exact.id }

  // An id prefix is only usable when it picks out exactly one run.
  const prefixed = candidates.filter((c) => c.id.toLowerCase().startsWith(lower))
  if (prefixed.length === 1) return { ok: true, value: prefixed[0].id }
  if (prefixed.length > 1) {
    return {
      ok: false,
      reason: `\`${raw}\` matches ${prefixed.length} runs — use its number instead.`,
    }
  }

  const named = candidates.filter((c) => (c.taskName ?? '').toLowerCase().includes(lower))
  if (named.length === 1) return { ok: true, value: named[0].id }
  if (named.length > 1) {
    return {
      ok: false,
      reason: `\`${raw}\` matches ${named.length} runs — use its number instead.`,
    }
  }

  return { ok: false, reason: `Could not find a run matching \`${raw}\`.` }
}

/**
 * Resolve an automation by name or id. Names are what people remember, so an
 * exact name wins, then a unique prefix, then a unique substring.
 */
export function resolveTaskRef(
  ref: string,
  candidates: readonly TaskCandidate[],
): ResolveResult<string> {
  const raw = ref.trim()
  if (!raw) return { ok: false, reason: 'Which automation? Try `automations` to list them.' }
  if (candidates.length === 0) {
    return { ok: false, reason: 'There are no automations yet.' }
  }

  const lower = raw.toLowerCase()

  const ordinalMatch = /^#(\d{1,3})$/.exec(raw)
  if (ordinalMatch) {
    const index = Number(ordinalMatch[1]) - 1
    const hit = candidates[index]
    return hit
      ? { ok: true, value: hit.id }
      : { ok: false, reason: `There is no automation #${ordinalMatch[1]}.` }
  }

  const byId = candidates.find((c) => c.id.toLowerCase() === lower)
  if (byId) return { ok: true, value: byId.id }

  const exactName = candidates.filter((c) => c.name.toLowerCase() === lower)
  if (exactName.length === 1) return { ok: true, value: exactName[0].id }

  const prefix = candidates.filter((c) => c.name.toLowerCase().startsWith(lower))
  if (prefix.length === 1) return { ok: true, value: prefix[0].id }

  const contains = candidates.filter((c) => c.name.toLowerCase().includes(lower))
  if (contains.length === 1) return { ok: true, value: contains[0].id }

  const ambiguous = prefix.length > 1 ? prefix : contains
  if (ambiguous.length > 1) {
    const names = ambiguous
      .slice(0, 4)
      .map((c) => `\`${c.name}\``)
      .join(', ')
    return { ok: false, reason: `\`${raw}\` matches ${ambiguous.length} automations: ${names}.` }
  }

  return { ok: false, reason: `Could not find an automation matching \`${raw}\`.` }
}
