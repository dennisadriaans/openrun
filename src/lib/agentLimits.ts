/**
 * "You've hit your usage limit" — the one agent failure that looks like work.
 *
 * A rate-limited CLI does not always exit. Codex prints the limit on its event
 * stream and then sits silent until the window resets, so the turn keeps its
 * spinner and the last tool call on screen until the wall-clock budget kills
 * it, tens of minutes later, with no hint of why.
 *
 * Only messages the runtime itself reported as errors are tested here — never
 * raw stderr, which carries whatever a tool the agent ran happened to print.
 */

const LIMIT_PATTERNS: RegExp[] = [
  /usage limit/i,
  /rate[- ]?limit(ed|s)?\b/i,
  /quota (exceeded|exhausted|reached)/i,
  /too many requests/i,
  /\b429\b/,
  /out of (credits|tokens)\b/i,
  /insufficient (credits|quota)/i,
]

export function isUsageLimitMessage(text: string): boolean {
  if (!text) return false
  return LIMIT_PATTERNS.some((re) => re.test(text))
}

/** "at 3:51 PM" / "in 20 minutes" — whatever the CLI offered, preposition kept. */
export function usageLimitRetryHint(text: string): string {
  const match = /(?:try again|retry|resets?|available again)\s+(at|in|after)\s+([^.\n)]{1,40})/i.exec(
    text ?? '',
  )
  return match ? `${match[1].toLowerCase()} ${match[2].trim()}` : ''
}

/** The stderr note that explains why the run was stopped. */
export function usageLimitStopMessage(text: string): string {
  const hint = usageLimitRetryHint(text)
  return `Stopped: the runtime reported a usage limit.${hint ? ` Retry ${hint}.` : ''}`
}
