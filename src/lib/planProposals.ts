/**
 * Planner proposal shapes + parsing.
 *
 * Shared by the Planner page, run-chat install cards, and the server write
 * path so chat never drifts from what `planObjective` stores.
 */

export type PlanProposal = {
  name: string
  description: string
  prompt: string
  cron: string
  cronReadable?: string
}

/** Stable key for dismiss / install tracking within a planner run. */
export function proposalFingerprint(p: Pick<PlanProposal, 'name' | 'cron' | 'prompt'>): string {
  return `${p.name.trim()}\0${p.cron.trim()}\0${p.prompt.trim()}`
}

function normalizeProposal(p: Partial<PlanProposal> | null | undefined): PlanProposal | null {
  if (!p || typeof p.prompt !== 'string') return null
  return {
    name: String(p.name ?? 'Untitled automation'),
    description: String(p.description ?? ''),
    prompt: String(p.prompt ?? ''),
    cron: String(p.cron ?? ''),
  }
}

/**
 * Extract the first JSON array of plan proposals from CLI stdout / chat content.
 * Returns [] when nothing parseable is found.
 */
export function parsePlanProposals(raw: string): PlanProposal[] {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0]) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => normalizeProposal(item as Partial<PlanProposal>))
      .filter((p): p is PlanProposal => p != null)
  } catch {
    return []
  }
}

/**
 * True when `text` looks like a planner JSON array (at least one element with a
 * string `prompt`). Used by chat to swap the JSON dump for install cards.
 */
export function looksLikePlanProposalArray(text: string): boolean {
  return parsePlanProposals(text).length > 0
}
