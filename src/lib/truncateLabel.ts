/** Compact labels for the run header — full value lives in the tooltip. */

const ELLIPSIS = '…'

export function truncateMiddle(text: string, max: number): string {
  const trimmed = text.trim()
  if (max < 2 || trimmed.length <= max) return trimmed
  if (max === 2) return ELLIPSIS
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${trimmed.slice(0, head)}${ELLIPSIS}${trimmed.slice(-tail)}`
}

export function truncateEnd(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  if (max < 2) return ELLIPSIS
  return `${oneLine.slice(0, max - 1).trimEnd()}${ELLIPSIS}`
}

/** Keeps the prefix before `/` and middle-truncates the branch slug. */
export function truncateBranchLabel(branch: string, max = 26): string {
  const trimmed = branch.trim()
  if (trimmed.length <= max) return trimmed

  const slash = trimmed.indexOf('/')
  if (slash > 0 && slash < trimmed.length - 1) {
    const prefix = trimmed.slice(0, slash + 1)
    const rest = trimmed.slice(slash + 1)
    const restBudget = max - prefix.length
    if (restBudget >= 5) return prefix + truncateMiddle(rest, restBudget)
  }

  return truncateMiddle(trimmed, max)
}

/** Conversation titles beside the branch switcher. */
export function truncateNavTitle(title: string, max = 36): string {
  return truncateEnd(title, max)
}
